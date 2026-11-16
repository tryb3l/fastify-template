'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUIDv7 } = require('node:crypto')
const { seedUser } = require('../../utils/setup-user')

describe('DELETE /notebooks/:id', () => {
  test('returns 204, deletes an empty notebook, records a sync tombstone, and writes notebook_deleted audit log', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const notebook = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Empty Notebook' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'DELETE',
      url: `/notebooks/${notebook.id}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 204)
    assert.equal(response.body, '')

    await assert.rejects(
      () => actor.app.notebooksDataSource.readNotebook(notebook.id, actor.userId),
      {
        statusCode: 404,
      },
    )

    const tombstone = await actor.app.mongo.db
      .collection('syncTombstones')
      .findOne({ userId: actor.userId, entityType: 'notebook', entityId: notebook.id })
    assert.ok(tombstone)

    await actor.app.flushAuditLogs()
    const auditDoc = await actor.app.mongo.db
      .collection('auditLogs')
      .findOne({ action: 'notebook_deleted', resourceId: notebook.id })
    assert.ok(auditDoc)
  })

  test('returns 400 when notebook id param is not a valid UUID', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'DELETE',
      url: '/notebooks/not-a-uuid',
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

    // Act
    const response = await actor.app.inject({
      method: 'DELETE',
      url: `/notebooks/${notebook.id}`,
    })

    // Assert
    assert.equal(response.statusCode, 401)
  })

  test('returns 404 when notebook does not exist', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'DELETE',
      url: `/notebooks/${randomUUIDv7()}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 404)
  })

  test('returns 404 when another user attempts to delete the notebook', async (t) => {
    // Arrange
    const owner = await seedUser(t)
    const intruder = await seedUser(t, { app: owner.app })
    const ownerNb = await owner.app.notebooksDataSource.createNotebook(
      { name: 'Owner NB' },
      owner.userId,
    )

    // Act
    const response = await intruder.app.inject({
      method: 'DELETE',
      url: `/notebooks/${ownerNb.id}`,
      headers: { Authorization: `Bearer ${intruder.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 404)
    const stillExists = await owner.app.notebooksDataSource.readNotebook(ownerNb.id, owner.userId)
    assert.equal(stillExists.id, ownerNb.id)
  })

  test('returns 409 NOTEBOOK_NOT_EMPTY when notebook still contains a folder', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const notebook = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Has Folder NB' },
      actor.userId,
    )
    await actor.app.notebooksDataSource.createFolder(
      { notebookId: notebook.id, name: 'Subfolder' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'DELETE',
      url: `/notebooks/${notebook.id}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 409)
    assert.equal(response.json().code, 'NOTEBOOK_NOT_EMPTY')
  })

  test('returns 409 NOTEBOOK_NOT_EMPTY when notebook still contains a root note', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const notebook = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Has Note NB' },
      actor.userId,
    )
    await actor.app.notesDataSource.createNote(
      { title: 'Root Note', body: 'inside notebook', notebookId: notebook.id },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'DELETE',
      url: `/notebooks/${notebook.id}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 409)
    assert.equal(response.json().code, 'NOTEBOOK_NOT_EMPTY')
  })
})
