'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUIDv7 } = require('node:crypto')
const { seedUser } = require('../../utils/setup-user')

describe('DELETE /notebooks/folders/:folderId', () => {
  test('returns 204, deletes an empty folder, records a sync tombstone, and writes folder_deleted audit log', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const notebook = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Delete Folder NB' },
      actor.userId,
    )
    const folder = await actor.app.notebooksDataSource.createFolder(
      { notebookId: notebook.id, name: 'Empty Folder' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'DELETE',
      url: `/notebooks/folders/${folder.id}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 204)
    assert.equal(response.body, '')

    await assert.rejects(() => actor.app.notebooksDataSource.readFolder(folder.id, actor.userId), {
      statusCode: 404,
    })

    const tombstone = await actor.app.mongo.db
      .collection('syncTombstones')
      .findOne({ userId: actor.userId, entityType: 'folder', entityId: folder.id })
    assert.ok(tombstone)

    await actor.app.flushAuditLogs()
    const auditDoc = await actor.app.mongo.db
      .collection('auditLogs')
      .findOne({ action: 'folder_deleted', resourceId: folder.id })
    assert.ok(auditDoc)
  })

  test('returns 400 when folderId param is not a valid UUID', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'DELETE',
      url: '/notebooks/folders/not-a-uuid',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
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
      method: 'DELETE',
      url: `/notebooks/folders/${folder.id}`,
    })

    // Assert
    assert.equal(response.statusCode, 401)
  })

  test('returns 404 when folder does not exist', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'DELETE',
      url: `/notebooks/folders/${randomUUIDv7()}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 404)
  })

  test('returns 404 when another user attempts to delete the folder', async (t) => {
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
      method: 'DELETE',
      url: `/notebooks/folders/${ownerFolder.id}`,
      headers: { Authorization: `Bearer ${intruder.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 404)
    const stillExists = await owner.app.notebooksDataSource.readFolder(ownerFolder.id, owner.userId)
    assert.equal(stillExists.id, ownerFolder.id)
  })

  test('returns 409 FOLDER_NOT_EMPTY when folder still contains a child subfolder', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const notebook = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Subfolder Guard NB' },
      actor.userId,
    )
    const parent = await actor.app.notebooksDataSource.createFolder(
      { notebookId: notebook.id, name: 'Parent' },
      actor.userId,
    )
    await actor.app.notebooksDataSource.createFolder(
      { notebookId: notebook.id, parentId: parent.id, name: 'Child' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'DELETE',
      url: `/notebooks/folders/${parent.id}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 409)
    assert.equal(response.json().code, 'FOLDER_NOT_EMPTY')
  })

  test('returns 409 FOLDER_NOT_EMPTY when folder still contains a note', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const notebook = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Note Guard NB' },
      actor.userId,
    )
    const folder = await actor.app.notebooksDataSource.createFolder(
      { notebookId: notebook.id, name: 'ADRs' },
      actor.userId,
    )
    await actor.app.notesDataSource.createNote(
      { title: 'ADR 0001', body: 'inside folder', notebookId: notebook.id, folderId: folder.id },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'DELETE',
      url: `/notebooks/folders/${folder.id}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 409)
    assert.equal(response.json().code, 'FOLDER_NOT_EMPTY')
  })
})
