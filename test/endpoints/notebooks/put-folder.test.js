'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUIDv7 } = require('node:crypto')
const { seedUser } = require('../../utils/setup-user')

describe('PUT /notebooks/folders/:folderId', () => {
  test('returns 200 renaming a folder and writing folder_updated audit log', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const notebook = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Rename NB' },
      actor.userId,
    )
    const folder = await actor.app.notebooksDataSource.createFolder(
      { notebookId: notebook.id, name: 'Old Name' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'PUT',
      url: `/notebooks/folders/${folder.id}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { name: 'Renamed Folder' },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.equal(response.json().data.id, folder.id)
    assert.equal(response.json().data.name, 'Renamed Folder')

    await actor.app.flushAuditLogs()
    const auditDoc = await actor.app.mongo.db
      .collection('auditLogs')
      .findOne({ action: 'folder_updated', resourceId: folder.id })
    assert.ok(auditDoc)
  })

  test('returns 200 reparenting a folder under another folder in the same notebook', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const notebook = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Sibling Reparent NB' },
      actor.userId,
    )
    const targetParent = await actor.app.notebooksDataSource.createFolder(
      { notebookId: notebook.id, name: 'Target Parent' },
      actor.userId,
    )
    const movingFolder = await actor.app.notebooksDataSource.createFolder(
      { notebookId: notebook.id, name: 'Moving Folder' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'PUT',
      url: `/notebooks/folders/${movingFolder.id}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { parentId: targetParent.id },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.equal(response.json().data.parentId, targetParent.id)
  })

  test('returns 200 promoting a nested folder to notebook root when parentId is null', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const notebook = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Reparent NB' },
      actor.userId,
    )
    const rootFolder = await actor.app.notebooksDataSource.createFolder(
      { notebookId: notebook.id, name: 'Root Folder' },
      actor.userId,
    )
    const childFolder = await actor.app.notebooksDataSource.createFolder(
      { notebookId: notebook.id, parentId: rootFolder.id, name: 'Child Folder' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'PUT',
      url: `/notebooks/folders/${childFolder.id}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { parentId: null },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.equal(response.json().data.parentId, null)
  })

  test('returns 400 when moving a folder under itself', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const notebook = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Self Cycle NB' },
      actor.userId,
    )
    const folder = await actor.app.notebooksDataSource.createFolder(
      { notebookId: notebook.id, name: 'Self Folder' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'PUT',
      url: `/notebooks/folders/${folder.id}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { parentId: folder.id },
    })

    // Assert
    assert.equal(response.statusCode, 400)
    assert.match(response.json().message, /own parent/)
  })

  test('returns 400 when moving a folder into its own descendant', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const notebook = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Cycle Guard NB' },
      actor.userId,
    )
    const level1 = await actor.app.notebooksDataSource.createFolder(
      { notebookId: notebook.id, name: 'Level 1' },
      actor.userId,
    )
    const level2 = await actor.app.notebooksDataSource.createFolder(
      { notebookId: notebook.id, parentId: level1.id, name: 'Level 2' },
      actor.userId,
    )
    const level3 = await actor.app.notebooksDataSource.createFolder(
      { notebookId: notebook.id, parentId: level2.id, name: 'Level 3' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'PUT',
      url: `/notebooks/folders/${level1.id}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { parentId: level3.id },
    })

    // Assert
    assert.equal(response.statusCode, 400)
    assert.match(response.json().message, /descendant/)
  })

  test('returns 400 when reparenting a subtree would exceed maximum depth of 5', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const notebook = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Subtree Depth NB' },
      actor.userId,
    )
    // Branch A: depth 4 (a1 -> a2 -> a3 -> a4)
    let parentA = null
    for (let depth = 1; depth <= 4; depth += 1) {
      const f = await actor.app.notebooksDataSource.createFolder(
        { notebookId: notebook.id, parentId: parentA, name: `A${depth}` },
        actor.userId,
      )
      parentA = f.id
    }
    // Branch B: depth 2 subtree (b1 -> b2)
    const b1 = await actor.app.notebooksDataSource.createFolder(
      { notebookId: notebook.id, name: 'B1' },
      actor.userId,
    )
    await actor.app.notebooksDataSource.createFolder(
      { notebookId: notebook.id, parentId: b1.id, name: 'B2' },
      actor.userId,
    )

    // Act — moving b1 (subtree height 1) under a4 (depth 4) would reach depth 6
    const response = await actor.app.inject({
      method: 'PUT',
      url: `/notebooks/folders/${b1.id}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { parentId: parentA },
    })

    // Assert
    assert.equal(response.statusCode, 400)
    assert.match(response.json().message, /maximum depth of 5/)
  })

  test('returns 400 when attempting to move a folder to a different notebookId', async (t) => {
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
      method: 'PUT',
      url: `/notebooks/folders/${folderInA.id}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { notebookId: notebookB.id },
    })

    // Assert
    assert.equal(response.statusCode, 400)
    assert.match(response.json().message, /different notebooks/)
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
    const folderInB = await actor.app.notebooksDataSource.createFolder(
      { notebookId: notebookB.id, name: 'Folder B' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'PUT',
      url: `/notebooks/folders/${folderInA.id}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { parentId: folderInB.id },
    })

    // Assert
    assert.equal(response.statusCode, 400)
    assert.match(response.json().message, /different notebooks/)
  })

  test('returns 400 when update payload is empty', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const notebook = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Empty Payload NB' },
      actor.userId,
    )
    const folder = await actor.app.notebooksDataSource.createFolder(
      { notebookId: notebook.id, name: 'Folder' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'PUT',
      url: `/notebooks/folders/${folder.id}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: {},
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 400 when folderId param is not a valid UUID', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'PUT',
      url: '/notebooks/folders/not-a-uuid',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { name: 'Invalid ID' },
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
    const folder = await actor.app.notebooksDataSource.createFolder(
      { notebookId: notebook.id, name: 'Protected Folder' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'PUT',
      url: `/notebooks/folders/${folder.id}`,
      payload: { name: 'Unauthorized Rename' },
    })

    // Assert
    assert.equal(response.statusCode, 401)
  })

  test('returns 404 when target parentId does not exist', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const notebook = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Missing Parent NB' },
      actor.userId,
    )
    const folder = await actor.app.notebooksDataSource.createFolder(
      { notebookId: notebook.id, name: 'Movable Folder' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'PUT',
      url: `/notebooks/folders/${folder.id}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { parentId: randomUUIDv7() },
    })

    // Assert
    assert.equal(response.statusCode, 404)
  })

  test('returns 404 when folder does not exist', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'PUT',
      url: `/notebooks/folders/${randomUUIDv7()}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { name: 'Ghost Folder' },
    })

    // Assert
    assert.equal(response.statusCode, 404)
  })

  test('returns 404 when another user attempts to update the folder', async (t) => {
    // Arrange
    const owner = await seedUser(t)
    const intruder = await seedUser(t, { app: owner.app })
    const ownerNb = await owner.app.notebooksDataSource.createNotebook(
      { name: 'Owner NB' },
      owner.userId,
    )
    const ownerFolder = await owner.app.notebooksDataSource.createFolder(
      { notebookId: ownerNb.id, name: 'Owner Folder' },
      owner.userId,
    )

    // Act
    const response = await intruder.app.inject({
      method: 'PUT',
      url: `/notebooks/folders/${ownerFolder.id}`,
      headers: { Authorization: `Bearer ${intruder.accessToken}` },
      payload: { name: 'Hijacked Folder' },
    })

    // Assert
    assert.equal(response.statusCode, 404)
    const unchanged = await owner.app.notebooksDataSource.readFolder(ownerFolder.id, owner.userId)
    assert.equal(unchanged.name, 'Owner Folder')
  })
})
