'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { createNote } = require('../../../../utils/note-creator')
const { setup } = require('../../../../utils/setup-user')

test('DELETE /notes/:id 204 - Deletes the note', async (t) => {
  // Arrange
  const { app, accessToken, note } = await createNote(t)

  // Act
  const response = await app.inject({
    method: 'DELETE',
    url: `/notes/${note.data.id}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  assert.strictEqual(response.statusCode, 204)


  const verify = await app.inject({
    method: 'GET',
    url: `/notes/${note.data.id}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  assert.strictEqual(verify.statusCode, 404)
})

test('DELETE /notes/:id 204 - Invalidates cached note reads after delete', async (t) => {
  // Arrange
  const { app, accessToken, note } = await createNote(t)

  const cachedReadResponse = await app.inject({
    method: 'GET',
    url: `/notes/${note.data.id}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  assert.strictEqual(cachedReadResponse.statusCode, 200)

  // Act
  const deleteResponse = await app.inject({
    method: 'DELETE',
    url: `/notes/${note.data.id}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  const verifyResponse = await app.inject({
    method: 'GET',
    url: `/notes/${note.data.id}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  assert.strictEqual(deleteResponse.statusCode, 204)
  assert.strictEqual(verifyResponse.statusCode, 404)
})

test('DELETE /notes/:id 404 - Returns 404 if not found', async (t) => {
  // Arrange
  const { app, accessToken } = await setup(t, 'user')
  const fakeId = '00000000-0000-0000-0000-000000000000'

  // Act
  const response = await app.inject({
    method: 'DELETE',
    url: `/notes/${fakeId}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  assert.strictEqual(response.statusCode, 404)
})

test('DELETE /notes/:id 404 - Different user cannot delete another users note', async (t) => {
  // Arrange
  const owner = await createNote(t)
  const intruder = await setup(t, 'user')

  // Act
  const response = await intruder.app.inject({
    method: 'DELETE',
    url: `/notes/${owner.note.data.id}`,
    headers: { Authorization: `Bearer ${intruder.accessToken}` },
  })

  // Assert
  assert.strictEqual(response.statusCode, 404)

  const ownerVerify = await owner.app.inject({
    method: 'GET',
    url: `/notes/${owner.note.data.id}`,
    headers: { Authorization: `Bearer ${owner.accessToken}` },
  })

  assert.strictEqual(ownerVerify.statusCode, 200)
})

test('DELETE /notes/:id 401 - Unauthorized', async (t) => {
  // Arrange
  const { app, note } = await createNote(t)

  // Act
  const response = await app.inject({
    method: 'DELETE',
    url: `/notes/${note.data.id}`,
  })

  // Assert
  assert.strictEqual(response.statusCode, 401)
})
