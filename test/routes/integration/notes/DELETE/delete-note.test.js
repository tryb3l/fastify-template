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
    url: `/notes/${note.data.id}?expectedRevision=${note.data.revision}`,
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
    url: `/notes/${note.data.id}?expectedRevision=${note.data.revision}`,
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
    url: `/notes/${fakeId}?expectedRevision=1`,
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
    url: `/notes/${owner.note.data.id}?expectedRevision=${owner.note.data.revision}`,
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
    url: `/notes/${note.data.id}?expectedRevision=${note.data.revision}`,
  })

  // Assert
  assert.strictEqual(response.statusCode, 401)
})

test('DELETE /notes/:id 400 - Rejects deletes missing expectedRevision', async (t) => {
  // Arrange
  const { app, accessToken, note } = await createNote(t)

  // Act
  const response = await app.inject({
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
  assert.strictEqual(response.statusCode, 400)
  assert.strictEqual(verifyResponse.statusCode, 200)
})

test('DELETE /notes/:id 409 - Rejects a stale delete without removing the latest note', async (t) => {
  // Arrange
  const { app, accessToken, note } = await createNote(t)
  const noteId = note.data.id
  const staleRevision = note.data.revision

  const updateResponse = await app.inject({
    method: 'PUT',
    url: `/notes/${noteId}`,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    payload: { title: 'Updated elsewhere', expectedRevision: staleRevision },
  })

  assert.strictEqual(updateResponse.statusCode, 200)

  // Act
  const deleteResponse = await app.inject({
    method: 'DELETE',
    url: `/notes/${noteId}?expectedRevision=${staleRevision}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  const verifyResponse = await app.inject({
    method: 'GET',
    url: `/notes/${noteId}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  assert.strictEqual(deleteResponse.statusCode, 409)
  assert.strictEqual(deleteResponse.json().code, 'NOTE_STALE_DELETE')
  assert.strictEqual(deleteResponse.json().currentRevision, updateResponse.json().data.revision)
  assert.strictEqual(verifyResponse.statusCode, 200)
  assert.strictEqual(verifyResponse.json().data.title, 'Updated elsewhere')
})
