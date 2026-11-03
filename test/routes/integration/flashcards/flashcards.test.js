'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { setup } = require('../../../utils/setup-user')

async function createNotebook(app, accessToken, payload) {
  const res = await app.inject({
    method: 'POST',
    url: '/notebooks',
    headers: { Authorization: `Bearer ${accessToken}` },
    payload,
  })
  assert.strictEqual(res.statusCode, 201, res.payload)
  return res.json().data
}

async function createFolder(app, accessToken, notebookId, payload) {
  const res = await app.inject({
    method: 'POST',
    url: `/notebooks/${notebookId}/folders`,
    headers: { Authorization: `Bearer ${accessToken}` },
    payload,
  })
  assert.strictEqual(res.statusCode, 201, res.payload)
  return res.json().data
}

async function createNote(app, accessToken, payload) {
  const res = await app.inject({
    method: 'POST',
    url: '/notes',
    headers: { Authorization: `Bearer ${accessToken}` },
    payload,
  })
  assert.strictEqual(res.statusCode, 201, res.payload)
  return res.json().data
}

async function createFlashcard(app, accessToken, payload) {
  const res = await app.inject({
    method: 'POST',
    url: '/flashcards',
    headers: { Authorization: `Bearer ${accessToken}` },
    payload,
  })
  assert.strictEqual(res.statusCode, 201, res.payload)
  return res.json().data
}

test('Flashcards CRUD, Tenant Isolation, and Scoped Dual-Mode Drills (scheduled & cram_all with 1-hop external link expansion)', async (t) => {
  const owner = await setup(t, 'user')
  const intruder = await setup(t, 'user')

  // 1. Create canonical Notebook & Note, plus a Campaign with a Folder & Note linking to the canonical Note
  const canonicalNb = await createNotebook(owner.app, owner.accessToken, {
    name: 'Algorithms KB',
    mode: 'notebook',
  })
  const canonicalNote = await createNote(owner.app, owner.accessToken, {
    title: 'Dijkstra Shortest Path',
    body: 'Priority queue relaxation',
    notebookId: canonicalNb.id,
  })

  const campaign = await createNotebook(owner.app, owner.accessToken, {
    name: 'Onsite Loop Prep',
    mode: 'campaign',
  })
  const folder = await createFolder(owner.app, owner.accessToken, campaign.id, {
    name: 'Graph Rounds',
  })
  const subfolder = await createFolder(owner.app, owner.accessToken, campaign.id, {
    name: 'Weighted Graphs',
    parentId: folder.id,
  })
  const campaignNote = await createNote(owner.app, owner.accessToken, {
    title: 'Network Routing Question',
    body: `Uses [[${canonicalNote.id}|Dijkstra]]`,
    notebookId: campaign.id,
    folderId: subfolder.id,
  })

  // 2. Create flashcards on both the Campaign Note and the 1-hop external canonical Note
  const card1 = await createFlashcard(owner.app, owner.accessToken, {
    noteId: campaignNote.id,
    front: 'What data structure gives O((V+E) log V) in Dijkstra?',
    back: 'Min-priority queue (binary heap)',
  })
  assert.strictEqual(card1.box, 1)
  assert.strictEqual(card1.lastReviewedAt, null)

  const card2 = await createFlashcard(owner.app, owner.accessToken, {
    noteId: canonicalNote.id,
    front: 'Can Dijkstra handle negative edge weights?',
    back: 'No, use Bellman-Ford',
  })

  // 3. Verify CRUD & Tenant Isolation (Intruder cannot read, update, review, or delete owner's flashcard)
  const intruderGetRes = await intruder.app.inject({
    method: 'GET',
    url: `/flashcards/${card1.id}`,
    headers: { Authorization: `Bearer ${intruder.accessToken}` },
  })
  assert.strictEqual(intruderGetRes.statusCode, 404)

  const intruderCreateOnOwnerNote = await intruder.app.inject({
    method: 'POST',
    url: '/flashcards',
    headers: { Authorization: `Bearer ${intruder.accessToken}` },
    payload: {
      noteId: campaignNote.id,
      front: 'IDOR front',
      back: 'IDOR back',
    },
  })
  assert.strictEqual(intruderCreateOnOwnerNote.statusCode, 404)

  // Update card1 front/back
  const updateCardRes = await owner.app.inject({
    method: 'PUT',
    url: `/flashcards/${card1.id}`,
    headers: { Authorization: `Bearer ${owner.accessToken}` },
    payload: {
      back: 'Binary or Fibonacci min-heap',
    },
  })
  assert.strictEqual(updateCardRes.statusCode, 200)
  assert.strictEqual(updateCardRes.json().data.back, 'Binary or Fibonacci min-heap')

  // List flashcards filtered by noteId, notebookId, folderId, and box
  const listByNoteRes = await owner.app.inject({
    method: 'GET',
    url: `/flashcards?noteId=${campaignNote.id}`,
    headers: { Authorization: `Bearer ${owner.accessToken}` },
  })
  assert.strictEqual(listByNoteRes.statusCode, 200)
  assert.strictEqual(listByNoteRes.json().data.length, 1)
  assert.strictEqual(listByNoteRes.json().data[0].id, card1.id)

  const listByCampaignRes = await owner.app.inject({
    method: 'GET',
    url: `/flashcards?notebookId=${campaign.id}&box=1`,
    headers: { Authorization: `Bearer ${owner.accessToken}` },
  })
  assert.strictEqual(listByCampaignRes.statusCode, 200)
  assert.strictEqual(listByCampaignRes.json().data.length, 2)

  // Reject whitespace-only front/back with 400
  const blankCardRes = await owner.app.inject({
    method: 'POST',
    url: '/flashcards',
    headers: { Authorization: `Bearer ${owner.accessToken}` },
    payload: {
      noteId: campaignNote.id,
      front: '   ',
      back: 'Valid back',
    },
  })
  assert.strictEqual(blankCardRes.statusCode, 400)

  // 4. Scoped Drill (GET /flashcards/drill?notebookId=<campaign.id>&mode=scheduled)
  // Both card1 (internal) and card2 (1-hop external canonical note) are immediately due at box 1
  const scheduledDrillRes = await owner.app.inject({
    method: 'GET',
    url: `/flashcards/drill?notebookId=${campaign.id}&mode=scheduled`,
    headers: { Authorization: `Bearer ${owner.accessToken}` },
  })
  assert.strictEqual(scheduledDrillRes.statusCode, 200, scheduledDrillRes.payload)
  const scheduledCards = scheduledDrillRes.json().data
  assert.strictEqual(scheduledCards.length, 2)

  const internalDrillCard = scheduledCards.find((c) => c.id === card1.id)
  const externalDrillCard = scheduledCards.find((c) => c.id === card2.id)
  assert.strictEqual(internalDrillCard.isExternal, false)
  assert.strictEqual(internalDrillCard.homeNotebookId, campaign.id)
  assert.strictEqual(internalDrillCard.noteTitle, campaignNote.title)

  assert.strictEqual(externalDrillCard.isExternal, true)
  assert.strictEqual(externalDrillCard.homeNotebookId, canonicalNb.id)
  assert.strictEqual(externalDrillCard.noteTitle, canonicalNote.title)

  // Folder-scoped drill on parent folder also rolls up subfolder + 1-hop external note cards
  const folderDrillRes = await owner.app.inject({
    method: 'GET',
    url: `/flashcards/drill?folderId=${folder.id}&mode=scheduled`,
    headers: { Authorization: `Bearer ${owner.accessToken}` },
  })
  assert.strictEqual(folderDrillRes.statusCode, 200)
  assert.strictEqual(folderDrillRes.json().data.length, 2)

  // Strict container-only drill (includeExternal=false) returns only card1
  const strictDrillRes = await owner.app.inject({
    method: 'GET',
    url: `/flashcards/drill?notebookId=${campaign.id}&mode=scheduled&includeExternal=false`,
    headers: { Authorization: `Bearer ${owner.accessToken}` },
  })
  assert.strictEqual(strictDrillRes.statusCode, 200)
  assert.strictEqual(strictDrillRes.json().data.length, 1)
  assert.strictEqual(strictDrillRes.json().data[0].id, card1.id)
})

test('Leitner Box Transitions, Cram All Mode, Bidirectional Parent Note Readiness Coupling, and Delta-Sync / Cascade Cleanup', async (t) => {
  const { app, accessToken } = await setup(t, 'user')

  const note = await createNote(app, accessToken, {
    title: 'Event Loop Phases',
    body: 'timers, pending, poll, check, close',
  })
  assert.strictEqual(note.readiness, 'to_review')

  const cardA = await createFlashcard(app, accessToken, {
    noteId: note.id,
    front: 'Which phase executes setImmediate callbacks?',
    back: 'check phase',
  })
  const cardB = await createFlashcard(app, accessToken, {
    noteId: note.id,
    front: 'When do process.nextTick callbacks run?',
    back: 'Immediately after the current operation before the event loop continues',
  })

  // 1. First review on cardA ('good'): box 1 -> 2 (+3d), and parent Note promotes 'to_review' -> 'in_progress'
  const rev1Res = await app.inject({
    method: 'POST',
    url: `/flashcards/${cardA.id}/review`,
    headers: { Authorization: `Bearer ${accessToken}` },
    payload: { rating: 'good' },
  })
  assert.strictEqual(rev1Res.statusCode, 200, rev1Res.payload)
  assert.strictEqual(rev1Res.json().data.flashcard.box, 2)
  assert.strictEqual(rev1Res.json().data.flashcard.reviewCount, 1)
  assert.strictEqual(rev1Res.json().data.flashcard.lapseCount, 0)
  assert.strictEqual(rev1Res.json().data.flashcard.lastRating, 'good')
  assert.strictEqual(rev1Res.json().data.noteReadiness, 'in_progress')

  // Verify scheduled drill now only returns cardB (since cardA's nextReviewAt is +3 days in the future)
  const scheduledAfterRev1 = await app.inject({
    method: 'GET',
    url: `/flashcards/drill?noteId=${note.id}&mode=scheduled`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  assert.strictEqual(scheduledAfterRev1.statusCode, 200)
  assert.strictEqual(scheduledAfterRev1.json().data.length, 1)
  assert.strictEqual(scheduledAfterRev1.json().data[0].id, cardB.id)

  // Verify cram_all mode returns BOTH cards (weakest_first puts box 1 cardB before box 2 cardA)
  const cramWeakestRes = await app.inject({
    method: 'GET',
    url: `/flashcards/drill?noteId=${note.id}&mode=cram_all&order=weakest_first`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  assert.strictEqual(cramWeakestRes.statusCode, 200)
  assert.deepStrictEqual(
    cramWeakestRes.json().data.map((c) => c.id),
    [cardB.id, cardA.id],
  )

  // Verify cram_all sequential order returns [cardA, cardB]
  const cramSeqRes = await app.inject({
    method: 'GET',
    url: `/flashcards/drill?noteId=${note.id}&mode=cram_all&order=sequential`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  assert.strictEqual(cramSeqRes.statusCode, 200)
  assert.deepStrictEqual(
    cramSeqRes.json().data.map((c) => c.id),
    [cardA.id, cardB.id],
  )

  // Verify cram_all shuffled order returns both cards
  const cramShuffledRes = await app.inject({
    method: 'GET',
    url: `/flashcards/drill?noteId=${note.id}&mode=cram_all&order=shuffled`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  assert.strictEqual(cramShuffledRes.statusCode, 200)
  assert.deepStrictEqual(
    new Set(cramShuffledRes.json().data.map((c) => c.id)),
    new Set([cardA.id, cardB.id]),
  )

  // 2. Advance both cardA and cardB to box 4 ('good' reviews) -> parent Note auto-promotes to 'mastered'
  // cardA is at box 2 -> 'good' (box 3) -> 'good' (box 4)
  await app.inject({
    method: 'POST',
    url: `/flashcards/${cardA.id}/review`,
    headers: { Authorization: `Bearer ${accessToken}` },
    payload: { rating: 'good' },
  })
  const cardAToBox4 = await app.inject({
    method: 'POST',
    url: `/flashcards/${cardA.id}/review`,
    headers: { Authorization: `Bearer ${accessToken}` },
    payload: { rating: 'good' },
  })
  assert.strictEqual(cardAToBox4.json().data.flashcard.box, 4)
  // cardB is still at box 1, so note is still 'in_progress'
  assert.strictEqual(cardAToBox4.json().data.noteReadiness, 'in_progress')

  // Advance cardB: box 1 -> 2 -> 3 -> 4
  await app.inject({
    method: 'POST',
    url: `/flashcards/${cardB.id}/review`,
    headers: { Authorization: `Bearer ${accessToken}` },
    payload: { rating: 'good' },
  })
  await app.inject({
    method: 'POST',
    url: `/flashcards/${cardB.id}/review`,
    headers: { Authorization: `Bearer ${accessToken}` },
    payload: { rating: 'good' },
  })
  const cardBToBox4 = await app.inject({
    method: 'POST',
    url: `/flashcards/${cardB.id}/review`,
    headers: { Authorization: `Bearer ${accessToken}` },
    payload: { rating: 'good' },
  })
  assert.strictEqual(cardBToBox4.json().data.flashcard.box, 4)
  assert.strictEqual(
    cardBToBox4.json().data.noteReadiness,
    'mastered',
    'Parent note must auto-promote to mastered when all cards reach box >= 4',
  )

  // 3. Rating 'hard' keeps box 4 unchanged
  const hardRevRes = await app.inject({
    method: 'POST',
    url: `/flashcards/${cardB.id}/review`,
    headers: { Authorization: `Bearer ${accessToken}` },
    payload: { rating: 'hard' },
  })
  assert.strictEqual(hardRevRes.json().data.flashcard.box, 4)
  assert.strictEqual(hardRevRes.json().data.noteReadiness, 'mastered')

  // 4. Rating 'again' resets cardB to box 1 AND auto-demotes parent Note from 'mastered' to 'in_progress'
  const againRevRes = await app.inject({
    method: 'POST',
    url: `/flashcards/${cardB.id}/review`,
    headers: { Authorization: `Bearer ${accessToken}` },
    payload: { rating: 'again' },
  })
  assert.strictEqual(againRevRes.json().data.flashcard.box, 1)
  assert.strictEqual(againRevRes.json().data.flashcard.lapseCount, 1)
  assert.strictEqual(againRevRes.json().data.flashcard.lastRating, 'again')
  assert.strictEqual(
    againRevRes.json().data.noteReadiness,
    'in_progress',
    'Lapsing a card with again must demote parent note from mastered to in_progress',
  )

  // 5. Verify Delta-Sync (GET /notes/sync) includes flashcards upserted and deletedIds
  const syncCursorBeforeDelete = new Date(Date.now() - 10_000).toISOString()
  const deleteCardARes = await app.inject({
    method: 'DELETE',
    url: `/flashcards/${cardA.id}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  assert.strictEqual(deleteCardARes.statusCode, 204)

  const syncRes = await app.inject({
    method: 'GET',
    url: `/notes/sync?since=${encodeURIComponent(syncCursorBeforeDelete)}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  assert.strictEqual(syncRes.statusCode, 200)
  const syncData = syncRes.json().data
  assert.ok(syncData.flashcards)
  assert.ok(syncData.flashcards.upserted.some((c) => c.id === cardB.id))
  assert.ok(syncData.flashcards.deletedIds.includes(cardA.id))

  // 6. Deleting the parent Note cascades to cardB and records a flashcard tombstone
  const currentNoteRes = await app.inject({
    method: 'GET',
    url: `/notes/${note.id}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const latestRevision = currentNoteRes.json().data.revision

  const deleteNoteRes = await app.inject({
    method: 'DELETE',
    url: `/notes/${note.id}?expectedRevision=${latestRevision}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  assert.strictEqual(deleteNoteRes.statusCode, 204)

  const syncAfterNoteDelete = await app.inject({
    method: 'GET',
    url: `/notes/sync?since=${encodeURIComponent(syncCursorBeforeDelete)}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  assert.ok(syncAfterNoteDelete.json().data.flashcards.deletedIds.includes(cardB.id))
})
