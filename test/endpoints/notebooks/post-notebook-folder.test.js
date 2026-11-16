'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUIDv7 } = require('node:crypto')
const { seedUser } = require('../../utils/setup-user')

describe('POST /notebooks/:id/folders', () => {
  test('returns 201 and creates a root folder inside the notebook with folder_created audit log', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const notebook = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Engineering' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: `/notebooks/${notebook.id}/folders`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { name: 'System Design' },
    })

    // Assert
    assert.equal(response.statusCode, 201)
    const folder = response.json().data
    assert.ok(folder.id)
    assert.equal(folder.notebookId, notebook.id)
    assert.equal(folder.parentId, null)
    assert.equal(folder.name, 'System Design')

    await actor.app.flushAuditLogs()
    const auditDoc = await actor.app.mongo.db
      .collection('auditLogs')
      .findOne({ action: 'folder_created', resourceId: folder.id })
    assert.ok(auditDoc)
  })

  test('returns 201 when creating a nested folder at maximum depth 5', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const notebook = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Nested NB' },
      actor.userId,
    )
    let parentId = null
    for (let depth = 1; depth <= 4; depth += 1) {
      const folder = await actor.app.notebooksDataSource.createFolder(
        { notebookId: notebook.id, parentId, name: `Level ${depth}` },
        actor.userId,
      )
      parentId = folder.id
    }

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: `/notebooks/${notebook.id}/folders`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { name: 'Level 5', parentId },
    })

    // Assert
    assert.equal(response.statusCode, 201)
    assert.equal(response.json().data.parentId, parentId)
    assert.equal(response.json().data.name, 'Level 5')
  })

  test('returns 400 when creating a nested folder at depth 6 exceeding maximum depth of 5', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const notebook = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Max Depth NB' },
      actor.userId,
    )
    let parentId = null
    for (let depth = 1; depth <= 5; depth += 1) {
      const folder = await actor.app.notebooksDataSource.createFolder(
        { notebookId: notebook.id, parentId, name: `Level ${depth}` },
        actor.userId,
      )
      parentId = folder.id
    }

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: `/notebooks/${notebook.id}/folders`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { name: 'Level 6 Exceeded', parentId },
    })

    // Assert
    assert.equal(response.statusCode, 400)
    assert.match(response.json().message, /maximum depth of 5/)
  })

  test('returns 400 when parentId belongs to a different notebook', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const notebookA = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Notebook A' },
      actor.userId,
    )
    const notebookB = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Notebook B' },
      actor.userId,
    )
    const folderInA = await actor.app.notebooksDataSource.createFolder(
      { notebookId: notebookA.id, name: 'Folder A' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: `/notebooks/${notebookB.id}/folders`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { name: 'Cross-Notebook Child', parentId: folderInA.id },
    })

    // Assert
    assert.equal(response.statusCode, 400)
    assert.match(response.json().message, /different notebook/)
  })

  test('returns 400 when name is missing or exceeds 100 characters', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const notebook = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Schema NB' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: `/notebooks/${notebook.id}/folders`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { name: 'f'.repeat(101) },
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 400 when notebook id or parentId is not a valid UUID', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: '/notebooks/not-a-uuid/folders',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { name: 'Invalid NB UUID' },
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 401 when unauthenticated', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const notebook = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Protected NB' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: `/notebooks/${notebook.id}/folders`,
      payload: { name: 'Unauthorized Folder' },
    })

    // Assert
    assert.equal(response.statusCode, 401)
  })

  test('returns 404 when parentId folder does not exist', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const notebook = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Orphan Parent NB' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: `/notebooks/${notebook.id}/folders`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { name: 'Child', parentId: randomUUIDv7() },
    })

    // Assert
    assert.equal(response.statusCode, 404)
  })

  test('returns 404 when target notebook does not exist', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: `/notebooks/${randomUUIDv7()}/folders`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { name: 'Missing NB Folder' },
    })

    // Assert
    assert.equal(response.statusCode, 404)
  })

  test('returns 404 when another user attempts to create a folder inside the notebook', async (t) => {
    // Arrange
    const owner = await seedUser(t)
    const intruder = await seedUser(t, { app: owner.app })
    const ownerNb = await owner.app.notebooksDataSource.createNotebook(
      { name: 'Owner NB' },
      owner.userId,
    )

    // Act
    const response = await intruder.app.inject({
      method: 'POST',
      url: `/notebooks/${ownerNb.id}/folders`,
      headers: { Authorization: `Bearer ${intruder.accessToken}` },
      payload: { name: 'Intruder Folder' },
    })

    // Assert
    assert.equal(response.statusCode, 404)
  })
})
