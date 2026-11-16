'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUIDv7 } = require('node:crypto')
const { seedUser } = require('../../utils/setup-user')

describe('GET /notebooks/:id/tree', () => {
  test('returns 200 with nested folder hierarchy up to 5 levels and accurate root/total/folder note counts', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const notebook = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Deep Tree NB' },
      actor.userId,
    )
    let parentId = null
    const createdFolders = []
    for (let depth = 1; depth <= 5; depth += 1) {
      const folder = await actor.app.notebooksDataSource.createFolder(
        { notebookId: notebook.id, parentId, name: `Level ${depth}` },
        actor.userId,
      )
      createdFolders.push(folder)
      parentId = folder.id
    }
    await actor.app.notesDataSource.createNote(
      { title: 'Root Note', body: 'root', notebookId: notebook.id },
      actor.userId,
    )
    await actor.app.notesDataSource.createNote(
      {
        title: 'Leaf Note',
        body: 'depth 5',
        notebookId: notebook.id,
        folderId: createdFolders[4].id,
      },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: `/notebooks/${notebook.id}/tree`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const tree = response.json().data
    assert.equal(tree.id, notebook.id)
    assert.equal(tree.rootNoteCount, 1)
    assert.equal(tree.totalNoteCount, 2)
    assert.equal(tree.folders.length, 1)

    let cursor = tree.folders[0]
    for (let index = 0; index < 4; index += 1) {
      assert.equal(cursor.id, createdFolders[index].id)
      assert.equal(cursor.noteCount, 0)
      assert.equal(cursor.children.length, 1)
      cursor = cursor.children[0]
    }
    assert.equal(cursor.id, createdFolders[4].id)
    assert.equal(cursor.noteCount, 1)
    assert.deepEqual(cursor.children, [])
  })

  test('returns 200 computing Readiness across internal and 1-hop external linked notes while excluding post_mortem notes', async (t) => {
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
        body: 'Virtual nodes',
        notebookId: canonicalNb.id,
        readiness: 'in_progress',
      },
      actor.userId,
    )

    const campaign = await actor.app.notebooksDataSource.createNotebook(
      {
        name: 'Cloudflare Interview Campaign',
        mode: 'campaign',
        targetDate: '2026-11-01T00:00:00.000Z',
      },
      actor.userId,
    )
    const sysDesignFolder = await actor.app.notebooksDataSource.createFolder(
      { notebookId: campaign.id, name: 'System Design' },
      actor.userId,
    )
    const deepDiveSubfolder = await actor.app.notebooksDataSource.createFolder(
      { notebookId: campaign.id, parentId: sysDesignFolder.id, name: 'State & Consensus' },
      actor.userId,
    )
    await actor.app.notesDataSource.createNote(
      {
        title: 'Global Rate Limiter Prep',
        body: `Study [[${canonicalMastered.id}|Raft]] and [[${canonicalInProgress.id}|Hashing]]`,
        notebookId: campaign.id,
        folderId: deepDiveSubfolder.id,
        readiness: 'to_review',
      },
      actor.userId,
    )
    await actor.app.notesDataSource.createNote(
      {
        title: 'Round 1 Phone Screen Debrief',
        body: 'Post-mortem note excluded from readiness denominator',
        notebookId: campaign.id,
        folderId: sysDesignFolder.id,
        readiness: 'to_review',
        noteType: 'post_mortem',
      },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: `/notebooks/${campaign.id}/tree`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const campaignTree = response.json().data
    assert.equal(campaignTree.mode, 'campaign')
    assert.deepEqual(campaignTree.readiness, {
      toReviewCount: 1,
      inProgressCount: 1,
      masteredCount: 1,
      totalCount: 3,
      scorePercent: 50,
      blocks: 5,
    })
    assert.equal(campaignTree.folders[0].id, sysDesignFolder.id)
    assert.deepEqual(campaignTree.folders[0].readiness, {
      toReviewCount: 1,
      inProgressCount: 1,
      masteredCount: 1,
      totalCount: 3,
      scorePercent: 50,
      blocks: 5,
    })
  })

  test('returns 400 when notebook id param is not a valid UUID', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: '/notebooks/not-a-uuid/tree',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 401 when unauthenticated', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const notebook = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Private Tree NB' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: `/notebooks/${notebook.id}/tree`,
    })

    // Assert
    assert.equal(response.statusCode, 401)
  })

  test('returns 404 when notebook does not exist', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: `/notebooks/${randomUUIDv7()}/tree`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 404)
  })

  test('returns 404 when another user attempts to read the notebook tree', async (t) => {
    // Arrange
    const owner = await seedUser(t)
    const intruder = await seedUser(t, { app: owner.app })
    const ownerNb = await owner.app.notebooksDataSource.createNotebook(
      { name: 'Owner Tree NB' },
      owner.userId,
    )

    // Act
    const response = await intruder.app.inject({
      method: 'GET',
      url: `/notebooks/${ownerNb.id}/tree`,
      headers: { Authorization: `Bearer ${intruder.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 404)
  })
})
