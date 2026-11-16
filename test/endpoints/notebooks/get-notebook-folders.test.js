'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUIDv7 } = require('node:crypto')
const { seedUser } = require('../../utils/setup-user')

describe('GET /notebooks/:id/folders', () => {
  test('returns 200 with folders sorted alphabetically by name excluding internal fields', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const notebook = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Folder List NB' },
      actor.userId,
    )
    const zulu = await actor.app.notebooksDataSource.createFolder(
      { notebookId: notebook.id, name: 'Zulu' },
      actor.userId,
    )
    const alpha = await actor.app.notebooksDataSource.createFolder(
      { notebookId: notebook.id, name: 'Alpha' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: `/notebooks/${notebook.id}/folders`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const { data } = response.json()
    assert.equal(data.length, 2)
    assert.equal(data[0].id, alpha.id)
    assert.equal(data[0].name, 'Alpha')
    assert.equal(data[1].id, zulu.id)
    assert.equal(data[1].name, 'Zulu')
    assert.equal(Object.hasOwn(data[0], '_id'), false)
    assert.equal(Object.hasOwn(data[0], 'userId'), false)
  })

  test('returns 200 with empty array when notebook has no folders', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const notebook = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Empty NB' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: `/notebooks/${notebook.id}/folders`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.deepEqual(response.json().data, [])
  })

  test('returns 400 when notebook id param is not a valid UUID', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: '/notebooks/not-a-uuid/folders',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 401 when unauthenticated', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const notebook = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Private NB' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: `/notebooks/${notebook.id}/folders`,
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
      url: `/notebooks/${randomUUIDv7()}/folders`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 404)
  })

  test('returns 404 when another user attempts to list folders of the notebook', async (t) => {
    // Arrange
    const owner = await seedUser(t)
    const intruder = await seedUser(t, { app: owner.app })
    const ownerNb = await owner.app.notebooksDataSource.createNotebook(
      { name: 'Owner NB' },
      owner.userId,
    )
    await owner.app.notebooksDataSource.createFolder(
      { notebookId: ownerNb.id, name: 'Secret Folder' },
      owner.userId,
    )

    // Act
    const response = await intruder.app.inject({
      method: 'GET',
      url: `/notebooks/${ownerNb.id}/folders`,
      headers: { Authorization: `Bearer ${intruder.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 404)
  })
})
