'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUIDv7 } = require('node:crypto')
const { seedUser } = require('../../utils/setup-user')

describe('GET /notebooks/folders/:folderId', () => {
  test('returns 200 with normalized folder metadata including parentId and notebookId', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const notebook = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Parent NB' },
      actor.userId,
    )
    const parentFolder = await actor.app.notebooksDataSource.createFolder(
      { notebookId: notebook.id, name: 'Parent Folder' },
      actor.userId,
    )
    const childFolder = await actor.app.notebooksDataSource.createFolder(
      { notebookId: notebook.id, parentId: parentFolder.id, name: 'Child Folder' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: `/notebooks/folders/${childFolder.id}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const { data } = response.json()
    assert.equal(data.id, childFolder.id)
    assert.equal(data.notebookId, notebook.id)
    assert.equal(data.parentId, parentFolder.id)
    assert.equal(data.name, 'Child Folder')
    assert.equal(Object.hasOwn(data, '_id'), false)
    assert.equal(Object.hasOwn(data, 'userId'), false)
  })

  test('returns 400 when folderId param is not a valid UUID', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'GET',
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
      method: 'GET',
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
      method: 'GET',
      url: `/notebooks/folders/${randomUUIDv7()}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 404)
  })

  test('returns 404 when another user attempts to read the folder', async (t) => {
    // Arrange
    const owner = await seedUser(t)
    const intruder = await seedUser(t, { app: owner.app })
    const ownerNb = await owner.app.notebooksDataSource.createNotebook(
      { name: 'Owner NB' },
      owner.userId,
    )
    const ownerFolder = await owner.app.notebooksDataSource.createFolder(
      { notebookId: ownerNb.id, name: 'Private Folder' },
      owner.userId,
    )

    // Act
    const response = await intruder.app.inject({
      method: 'GET',
      url: `/notebooks/folders/${ownerFolder.id}`,
      headers: { Authorization: `Bearer ${intruder.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 404)
  })
})
