'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { seedUser } = require('../../utils/setup-user')

describe('GET /dashboard/summary', () => {
  test('returns 200 with zeroed counts, empty active containers, 84-day heatmap, and 14-day velocity for a fresh user', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: '/dashboard/summary',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const summary = response.json().data
    assert.equal(summary.inboxNoteCount, 0)
    assert.equal(summary.dueFlashcardsCount, 0)
    assert.deepEqual(summary.activeCampaigns, [])
    assert.deepEqual(summary.activeNotebooks, [])
    assert.equal(summary.heatmap12Weeks.length, 84)
    assert.equal(summary.velocity14Days.days.length, 14)
    assert.deepEqual(summary.velocity14Days.totals, {
      totalActions: 0,
      notesCreated: 0,
      notesUpdated: 0,
      flashcardsReviewed: 0,
    })
  })

  test('returns 200 aggregating inboxNoteCount, dueFlashcardsCount, activeCampaigns, activeNotebooks, 84-day heatmap, and 14-day velocity', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    await actor.app.notesDataSource.createNote(
      { title: 'Quick Inbox Capture', body: 'Unsorted thought' },
      actor.userId,
    )

    const notebook = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Distributed Systems', mode: 'notebook' },
      actor.userId,
    )
    const canonicalNote = await actor.app.notesDataSource.createNote(
      {
        title: 'Paxos & Raft',
        body: 'Consensus protocols',
        notebookId: notebook.id,
        readiness: 'mastered',
      },
      actor.userId,
    )

    const campaign = await actor.app.notebooksDataSource.createNotebook(
      {
        name: 'Staff Backend Interview',
        mode: 'campaign',
        targetDate: '2026-11-15T09:00:00.000Z',
      },
      actor.userId,
    )
    const campaignNote = await actor.app.notesDataSource.createNote(
      {
        title: 'Architecture Round Prep',
        body: `Review [[${canonicalNote.id}]]`,
        notebookId: campaign.id,
        readiness: 'in_progress',
      },
      actor.userId,
    )
    const updatedCampaignNote = await actor.app.notesDataSource.updateNote(
      campaignNote.id,
      {
        expectedRevision: campaignNote.revision,
        body: `Review [[${canonicalNote.id}]] thoroughly`,
      },
      actor.userId,
    )
    // No-op autosave must not increment notesUpdated
    await actor.app.notesDataSource.updateNote(
      campaignNote.id,
      {
        expectedRevision: updatedCampaignNote.revision,
        body: `Review [[${canonicalNote.id}]] thoroughly`,
      },
      actor.userId,
    )
    await actor.app.notesDataSource.createNote(
      {
        title: 'Round 1 Debrief',
        body: 'Post-mortem note excluded from readiness denominator',
        notebookId: campaign.id,
        noteType: 'post_mortem',
      },
      actor.userId,
    )
    await actor.app.notebooksDataSource.createNotebook(
      { name: 'Past Campaign', mode: 'campaign', status: 'archived' },
      actor.userId,
    )

    const card1 = await actor.app.flashcardsDataSource.createFlashcard(
      {
        noteId: canonicalNote.id,
        front: 'What is leader election in Raft?',
        back: 'Randomized election timeouts.',
      },
      actor.userId,
    )
    await actor.app.flashcardsDataSource.createFlashcard(
      {
        noteId: campaignNote.id,
        front: 'What is split-brain?',
        back: 'Two nodes believing they are leader simultaneously.',
      },
      actor.userId,
    )
    await actor.app.flashcardsDataSource.reviewFlashcard(card1.id, 'good', actor.userId)

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: '/dashboard/summary',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const summary = response.json().data
    assert.equal(summary.inboxNoteCount, 1)
    assert.equal(summary.dueFlashcardsCount, 1)

    assert.equal(summary.activeCampaigns.length, 1)
    const activeCamp = summary.activeCampaigns[0]
    assert.equal(activeCamp.id, campaign.id)
    assert.equal(activeCamp.targetDate, '2026-11-15T09:00:00.000Z')
    assert.equal(activeCamp.totalNoteCount, 2)
    assert.deepEqual(activeCamp.readiness, {
      toReviewCount: 0,
      inProgressCount: 1,
      masteredCount: 1,
      totalCount: 2,
      scorePercent: 75,
      blocks: 8,
    })

    assert.equal(summary.activeNotebooks.length, 1)
    const activeNb = summary.activeNotebooks[0]
    assert.equal(activeNb.id, notebook.id)
    assert.equal(activeNb.totalNoteCount, 1)
    assert.deepEqual(activeNb.readiness, {
      toReviewCount: 0,
      inProgressCount: 0,
      masteredCount: 1,
      totalCount: 1,
      scorePercent: 100,
      blocks: 10,
    })

    const todayHeatmap = summary.heatmap12Weeks[83]
    assert.equal(todayHeatmap.notesCreated, 4)
    assert.equal(todayHeatmap.postMortemsCreated, 1)
    assert.equal(todayHeatmap.notesUpdated, 1)
    assert.equal(todayHeatmap.flashcardsCreated, 2)
    assert.equal(todayHeatmap.flashcardsReviewed, 1)
    assert.equal(todayHeatmap.totalActions, 8)

    assert.deepEqual(summary.velocity14Days.totals, {
      totalActions: 8,
      notesCreated: 4,
      notesUpdated: 1,
      flashcardsReviewed: 1,
    })
  })

  test('returns 200 including 1-hop external linked Notes from archived Notebooks and Inbox in active Campaign Readiness without counting unrelated archived Notes', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const linkedInbox = await actor.app.notesDataSource.createNote(
      { title: 'Linked Inbox Reference', body: 'Canonical snippet', readiness: 'mastered' },
      actor.userId,
    )
    await actor.app.notesDataSource.createNote(
      { title: 'Unrelated Inbox Scratch', body: 'Scratchpad', readiness: 'to_review' },
      actor.userId,
    )

    const archivedNb = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Archived University Notes', mode: 'notebook', status: 'archived' },
      actor.userId,
    )
    const linkedArchivedNote = await actor.app.notesDataSource.createNote(
      {
        title: 'OS Virtual Memory',
        body: 'Page tables and TLB',
        notebookId: archivedNb.id,
        readiness: 'mastered',
      },
      actor.userId,
    )
    await actor.app.notesDataSource.createNote(
      {
        title: 'Old Compiler Homework',
        body: 'Unrelated archived note',
        notebookId: archivedNb.id,
        readiness: 'to_review',
      },
      actor.userId,
    )

    const activeCamp = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Systems Interview Campaign', mode: 'campaign' },
      actor.userId,
    )
    await actor.app.notesDataSource.createNote(
      {
        title: 'Memory Management Prep',
        body: `See [[${linkedInbox.id}]] and [[${linkedArchivedNote.id}]]`,
        notebookId: activeCamp.id,
        readiness: 'to_review',
      },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: '/dashboard/summary',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const summary = response.json().data
    assert.equal(summary.inboxNoteCount, 2)
    assert.equal(summary.activeNotebooks.length, 0)
    assert.equal(summary.activeCampaigns.length, 1)
    assert.equal(summary.activeCampaigns[0].id, activeCamp.id)
    assert.equal(summary.activeCampaigns[0].totalNoteCount, 1)
    assert.deepEqual(summary.activeCampaigns[0].readiness, {
      toReviewCount: 1,
      inProgressCount: 0,
      masteredCount: 2,
      totalCount: 3,
      scorePercent: 67,
      blocks: 7,
    })
  })

  test('returns 200 isolating dashboard telemetry and counts from other users', async (t) => {
    // Arrange
    const owner = await seedUser(t)
    const otherUser = await seedUser(t, { app: owner.app })
    await owner.app.notesDataSource.createNote(
      { title: 'Owner Inbox Note', body: 'secret' },
      owner.userId,
    )
    await owner.app.notebooksDataSource.createNotebook(
      { name: 'Owner Active Campaign', mode: 'campaign' },
      owner.userId,
    )

    // Act
    const response = await otherUser.app.inject({
      method: 'GET',
      url: '/dashboard/summary',
      headers: { Authorization: `Bearer ${otherUser.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const summary = response.json().data
    assert.equal(summary.inboxNoteCount, 0)
    assert.equal(summary.dueFlashcardsCount, 0)
    assert.deepEqual(summary.activeCampaigns, [])
    assert.deepEqual(summary.activeNotebooks, [])
    assert.equal(summary.velocity14Days.totals.totalActions, 0)
  })

  test('returns 401 when unauthenticated', async (t) => {
    // Arrange
    const { app } = await seedUser(t)

    // Act
    const response = await app.inject({
      method: 'GET',
      url: '/dashboard/summary',
    })

    // Assert
    assert.equal(response.statusCode, 401)
  })
})
