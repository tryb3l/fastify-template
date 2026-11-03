'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { setup } = require('../../../utils/setup-user')
const { getTestMongoUrl } = require('../../../test-setup')

function replaceDatabaseName(mongoUrl, databaseName) {
  return mongoUrl.replace(/\/[^/?]+(?=$|\?)/, `/${databaseName}`)
}

test('GET /dashboard/summary - Aggregates inboxNoteCount, dueFlashcardsCount, activeCampaigns, activeNotebooks, 84-day heatmap, and 14-day velocity', async (t) => {
  const customEnv = {
    MONGO_URL: replaceDatabaseName(getTestMongoUrl(), 'dashboard-test-db'),
  }
  const { app, accessToken } = await setup(t, 'user', customEnv)
  const headers = { Authorization: `Bearer ${accessToken}` }

  // 1. Initial empty summary
  const emptyRes = await app.inject({
    method: 'GET',
    url: '/dashboard/summary',
    headers,
  })
  assert.strictEqual(emptyRes.statusCode, 200)
  const emptySummary = emptyRes.json().data
  assert.strictEqual(emptySummary.inboxNoteCount, 0)
  assert.strictEqual(emptySummary.dueFlashcardsCount, 0)
  assert.strictEqual(emptySummary.activeCampaigns.length, 0)
  assert.strictEqual(emptySummary.activeNotebooks.length, 0)
  assert.strictEqual(emptySummary.heatmap12Weeks.length, 84)
  assert.strictEqual(emptySummary.velocity14Days.days.length, 14)
  assert.strictEqual(emptySummary.velocity14Days.totals.totalActions, 0)

  // 2. Create an Inbox note
  const inboxNoteRes = await app.inject({
    method: 'POST',
    url: '/notes',
    headers,
    payload: {
      title: 'Quick Inbox Capture',
      body: 'Unsorted thought',
    },
  })
  assert.strictEqual(inboxNoteRes.statusCode, 201)

  // 3. Create an evergreen Notebook with a canonical Note ('mastered')
  const nbRes = await app.inject({
    method: 'POST',
    url: '/notebooks',
    headers,
    payload: {
      name: 'Distributed Systems',
      mode: 'notebook',
    },
  })
  assert.strictEqual(nbRes.statusCode, 201)
  const notebookId = nbRes.json().data.id

  const canonicalNoteRes = await app.inject({
    method: 'POST',
    url: '/notes',
    headers,
    payload: {
      title: 'Paxos & Raft',
      body: 'Consensus protocols',
      notebookId,
      readiness: 'mastered',
    },
  })
  assert.strictEqual(canonicalNoteRes.statusCode, 201)
  const canonicalNoteId = canonicalNoteRes.json().data.id

  // 4. Create an active Campaign with a note linking 1-hop to the canonical Note + a post_mortem note
  const campaignRes = await app.inject({
    method: 'POST',
    url: '/notebooks',
    headers,
    payload: {
      name: 'Staff Backend Interview',
      mode: 'campaign',
      targetDate: '2026-11-15T09:00:00.000Z',
    },
  })
  assert.strictEqual(campaignRes.statusCode, 201)
  const campaignId = campaignRes.json().data.id

  const campaignNoteRes = await app.inject({
    method: 'POST',
    url: '/notes',
    headers,
    payload: {
      title: 'Architecture Round Prep',
      body: `Review [[${canonicalNoteId}]]`,
      notebookId: campaignId,
      readiness: 'in_progress',
    },
  })
  assert.strictEqual(campaignNoteRes.statusCode, 201)
  const campaignNote = campaignNoteRes.json().data

  // Update the campaign note (non-no-op) to verify notesUpdated counter
  const updateNoteRes = await app.inject({
    method: 'PUT',
    url: `/notes/${campaignNote.id}`,
    headers,
    payload: {
      expectedRevision: campaignNote.revision,
      body: `Review [[${canonicalNoteId}]] thoroughly`,
    },
  })
  assert.strictEqual(updateNoteRes.statusCode, 200)

  // No-op autosave must NOT increment notesUpdated
  const noOpNoteRes = await app.inject({
    method: 'PUT',
    url: `/notes/${campaignNote.id}`,
    headers,
    payload: {
      expectedRevision: updateNoteRes.json().data.revision,
      body: `Review [[${canonicalNoteId}]] thoroughly`,
    },
  })
  assert.strictEqual(noOpNoteRes.statusCode, 200)

  // Create a post_mortem note in the Campaign
  const postMortemRes = await app.inject({
    method: 'POST',
    url: '/notes',
    headers,
    payload: {
      title: 'Round 1 Debrief',
      body: 'Need faster back-of-the-envelope math',
      notebookId: campaignId,
      noteType: 'post_mortem',
    },
  })
  assert.strictEqual(postMortemRes.statusCode, 201)

  // Create an archived Campaign (must NOT appear in activeCampaigns)
  const archivedCampaignRes = await app.inject({
    method: 'POST',
    url: '/notebooks',
    headers,
    payload: {
      name: 'Past Campaign',
      mode: 'campaign',
      status: 'archived',
    },
  })
  assert.strictEqual(archivedCampaignRes.statusCode, 201)

  // 5. Create 2 Flashcards and review 1 of them ('good' moves it into future, leaving 1 due)
  const card1Res = await app.inject({
    method: 'POST',
    url: '/flashcards',
    headers,
    payload: {
      noteId: canonicalNoteId,
      front: 'What is leader election in Raft?',
      back: 'Randomized election timeouts.',
    },
  })
  assert.strictEqual(card1Res.statusCode, 201)
  const card1Id = card1Res.json().data.id

  const card2Res = await app.inject({
    method: 'POST',
    url: '/flashcards',
    headers,
    payload: {
      noteId: campaignNote.id,
      front: 'What is split-brain?',
      back: 'Two nodes believing they are leader simultaneously.',
    },
  })
  assert.strictEqual(card2Res.statusCode, 201)

  const reviewCard1Res = await app.inject({
    method: 'POST',
    url: `/flashcards/${card1Id}/review`,
    headers,
    payload: { rating: 'good' },
  })
  assert.strictEqual(reviewCard1Res.statusCode, 200)

  // 6. Query GET /dashboard/summary and assert all rollups and telemetry counters
  const summaryRes = await app.inject({
    method: 'GET',
    url: '/dashboard/summary',
    headers,
  })
  assert.strictEqual(summaryRes.statusCode, 200)
  const summary = summaryRes.json().data

  assert.strictEqual(summary.inboxNoteCount, 1)
  assert.strictEqual(summary.dueFlashcardsCount, 1)

  assert.strictEqual(summary.activeCampaigns.length, 1)
  const activeCamp = summary.activeCampaigns[0]
  assert.strictEqual(activeCamp.id, campaignId)
  assert.strictEqual(activeCamp.targetDate, '2026-11-15T09:00:00.000Z')
  assert.strictEqual(activeCamp.totalNoteCount, 2)
  // Campaign readiness includes campaignNote ('in_progress' = 0.5) + 1-hop canonicalNote ('mastered' = 1.0), excluding post_mortem -> 1.5 / 2 = 75%, blocks = 8
  assert.deepStrictEqual(activeCamp.readiness, {
    toReviewCount: 0,
    inProgressCount: 1,
    masteredCount: 1,
    totalCount: 2,
    scorePercent: 75,
    blocks: 8,
  })

  assert.strictEqual(summary.activeNotebooks.length, 1)
  const activeNb = summary.activeNotebooks[0]
  assert.strictEqual(activeNb.id, notebookId)
  assert.strictEqual(activeNb.totalNoteCount, 1)
  assert.deepStrictEqual(activeNb.readiness, {
    toReviewCount: 0,
    inProgressCount: 0,
    masteredCount: 1,
    totalCount: 1,
    scorePercent: 100,
    blocks: 10,
  })

  // Check today's entry in heatmap12Weeks (last element of the 84-day array)
  const todayHeatmap = summary.heatmap12Weeks[83]
  assert.strictEqual(todayHeatmap.notesCreated, 4)
  assert.strictEqual(todayHeatmap.postMortemsCreated, 1)
  assert.strictEqual(todayHeatmap.notesUpdated, 1)
  assert.strictEqual(todayHeatmap.flashcardsCreated, 2)
  assert.strictEqual(todayHeatmap.flashcardsReviewed, 1)
  // totalActions = notesCreated (4) + notesUpdated (1) + flashcardsCreated (2) + flashcardsReviewed (1) = 8
  assert.strictEqual(todayHeatmap.totalActions, 8)

  // Check 14-day velocity totals
  assert.deepStrictEqual(summary.velocity14Days.totals, {
    totalActions: 8,
    notesCreated: 4,
    notesUpdated: 1,
    flashcardsReviewed: 1,
  })
})
