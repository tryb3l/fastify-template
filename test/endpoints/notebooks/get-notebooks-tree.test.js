'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { seedUser } = require('../../utils/setup-user')

describe('GET /notebooks/tree', () => {
  test('returns 200 with inboxNoteCount, Notebook rootNoteCount, totalNoteCount, and nested Folder noteCount', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const notebook = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Architecture' },
      actor.userId,
    )
    const folder = await actor.app.notebooksDataSource.createFolder(
      { notebookId: notebook.id, name: 'ADRs' },
      actor.userId,
    )
    await actor.app.notesDataSource.createNote(
      { title: 'Quick Inbox Thought', body: 'Unfiled note' },
      actor.userId,
    )
    await actor.app.notesDataSource.createNote(
      { title: 'Overview Note', body: 'At notebook root', notebookId: notebook.id },
      actor.userId,
    )
    await actor.app.notesDataSource.createNote(
      {
        title: 'ADR 0001',
        body: 'Inside ADRs folder',
        notebookId: notebook.id,
        folderId: folder.id,
      },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: '/notebooks/tree',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const workspaceTree = response.json().data
    assert.equal(workspaceTree.inboxNoteCount, 1)
    assert.equal(workspaceTree.notebooks.length, 1)
    assert.equal(workspaceTree.notebooks[0].id, notebook.id)
    assert.equal(workspaceTree.notebooks[0].rootNoteCount, 1)
    assert.equal(workspaceTree.notebooks[0].totalNoteCount, 2)
    assert.equal(workspaceTree.notebooks[0].folders.length, 1)
    assert.equal(workspaceTree.notebooks[0].folders[0].id, folder.id)
    assert.equal(workspaceTree.notebooks[0].folders[0].noteCount, 1)
  })

  test('returns 200 computing weighted Readiness rollups, excluding post_mortem notes, and expanding 1-hop external Note Links', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const canonicalNb = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Distributed Systems KB', mode: 'notebook' },
      actor.userId,
    )
    const canonicalMastered = await actor.app.notesDataSource.createNote(
      {
        title: 'Raft Consensus',
        body: 'Leader election',
        notebookId: canonicalNb.id,
        readiness: 'mastered',
      },
      actor.userId,
    )
    const canonicalInProgress = await actor.app.notesDataSource.createNote(
      {
        title: 'Consistent Hashing',
        body: 'Ring topology',
        notebookId: canonicalNb.id,
        readiness: 'in_progress',
      },
      actor.userId,
    )

    const campaign = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Interview Campaign', mode: 'campaign' },
      actor.userId,
    )
    const parentFolder = await actor.app.notebooksDataSource.createFolder(
      { notebookId: campaign.id, name: 'System Design' },
      actor.userId,
    )
    const childFolder = await actor.app.notebooksDataSource.createFolder(
      { notebookId: campaign.id, parentId: parentFolder.id, name: 'State & Consensus' },
      actor.userId,
    )
    await actor.app.notesDataSource.createNote(
      {
        title: 'Global Rate Limiter Prep',
        body: `Study [[${canonicalMastered.id}|Raft]] and [[${canonicalInProgress.id}|Hashing]]`,
        notebookId: campaign.id,
        folderId: childFolder.id,
        readiness: 'mastered',
      },
      actor.userId,
    )
    await actor.app.notesDataSource.createNote(
      {
        title: 'Phone Screen Debrief',
        body: 'Excluded from readiness denominator',
        notebookId: campaign.id,
        folderId: parentFolder.id,
        readiness: 'to_review',
        noteType: 'post_mortem',
      },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: '/notebooks/tree',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const campaignNode = response.json().data.notebooks.find((nb) => nb.id === campaign.id)
    assert.ok(campaignNode)
    // 2 mastered (1.0 each) + 1 in_progress (0.5) = 2.5 / 3 -> 83% -> 8 blocks
    assert.deepEqual(campaignNode.readiness, {
      toReviewCount: 0,
      inProgressCount: 1,
      masteredCount: 2,
      totalCount: 3,
      scorePercent: 83,
      blocks: 8,
    })
    assert.deepEqual(campaignNode.folders[0].readiness, {
      toReviewCount: 0,
      inProgressCount: 1,
      masteredCount: 2,
      totalCount: 3,
      scorePercent: 83,
      blocks: 8,
    })
  })

  test('returns 200 with zero inboxNoteCount and empty notebooks array for another user', async (t) => {
    // Arrange
    const owner = await seedUser(t)
    const intruder = await seedUser(t, { app: owner.app })
    await owner.app.notebooksDataSource.createNotebook({ name: 'Owner NB' }, owner.userId)
    await owner.app.notesDataSource.createNote(
      { title: 'Owner Inbox Note', body: 'secret' },
      owner.userId,
    )

    // Act
    const response = await intruder.app.inject({
      method: 'GET',
      url: '/notebooks/tree',
      headers: { Authorization: `Bearer ${intruder.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.deepEqual(response.json().data, {
      inboxNoteCount: 0,
      notebooks: [],
    })
  })

  test('returns 401 when unauthenticated', async (t) => {
    // Arrange
    const { app } = await seedUser(t)

    // Act
    const response = await app.inject({
      method: 'GET',
      url: '/notebooks/tree',
    })

    // Assert
    assert.equal(response.statusCode, 401)
  })
})
