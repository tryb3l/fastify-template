'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { createNote } = require('../../../../utils/note-creator')
const { randomString } = require('../../../../utils/data-creator')
const { randomUUID } = require('node:crypto')
const { setup } = require('../../../../utils/setup-user')

test('GET by id /notes/:id 200 - Fetch note by id', async (t) => {
  // Arrange
  const { note, app, accessToken } = await createNote(t)

  // Act
  const response = await app.inject({
    method: 'GET',
    url: `/notes/${note.data.id}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  assert.strictEqual(response.statusCode, 200)
  const body = response.json()
  assert.strictEqual(body.data.id, note.data.id)
  assert.strictEqual(body.data.title, note.data.title)
  assert.strictEqual(body.data.body, note.data.body)
})

test('GET by id /notes/:id 404 - Note not found', async (t) => {
  // Arrange
  const { app, accessToken } = await createNote(t)
  const nonExistentNoteId = randomUUID()

  // Act
  const response = await app.inject({
    method: 'GET',
    url: `/notes/${nonExistentNoteId}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  assert.strictEqual(response.statusCode, 404)
})

test('GET by id /notes/:id 404 - Different user cannot read another users note', async (t) => {
  // Arrange
  const owner = await createNote(t)
  const intruder = await setup(t, 'user')

  // Act
  const response = await intruder.app.inject({
    method: 'GET',
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

test('GET by id /notes/:id 400 - Invalid id format', async (t) => {
  // Arrange
  const { app, accessToken } = await createNote(t)
  const invalidNoteId = randomString('1234567890', 10)

  // Act
  const response = await app.inject({
    method: 'GET',
    url: `/notes/${invalidNoteId}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  assert.strictEqual(response.statusCode, 400)
})

test('GET by id /notes/:id 401 - Unauthorized when no token is provided', async (t) => {
  // Arrange
  const { note, app } = await createNote(t)

  // Act
  const response = await app.inject({
    method: 'GET',
    url: `/notes/${note.data.id}`,
    // No Authorization header
  })

  // Assert
  assert.strictEqual(response.statusCode, 401)
})