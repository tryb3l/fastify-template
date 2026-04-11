'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { randomUUID } = require('node:crypto')
const { createNote } = require('../../../../utils/note-creator')
const { randomString } = require('../../../../utils/data-creator')
const { setup } = require('../../../../utils/setup-user')

test('PUT /notes/:id 200 - Update a note', async (t) => {
  // Arrange
  const { app, accessToken, note } = await createNote(t)
  const noteId = note.data.id

  const updatedNote = {
    title: randomString(15),
    body: randomString(30),
    tags: [randomString(5), randomString(5)],
  }

  // Act
  const response = await app.inject({
    method: 'PUT',
    url: `/notes/${noteId}`,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    payload: updatedNote,
  })

  // Assert
  assert.strictEqual(response.statusCode, 200)

  const payload = response.json()
  assert.ok(payload.data)
  assert.strictEqual(payload.data.id, noteId)
  assert.strictEqual(payload.data.title, updatedNote.title)
  assert.strictEqual(payload.data.body, updatedNote.body)
  assert.deepStrictEqual(payload.data.tags, updatedNote.tags)
})

test('PUT /notes/:id 404 - Note not found', async (t) => {
  // Arrange
  const { app, accessToken } = await createNote(t)
  const nonExistentNoteId = randomUUID()

  // Act
  const response = await app.inject({
    method: 'PUT',
    url: `/notes/${nonExistentNoteId}`,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    payload: { title: randomString(10), body: randomString(20) },
  })

  // Assert
  assert.strictEqual(response.statusCode, 404)
})

test('PUT /notes/:id 404 - Different user cannot update another users note', async (t) => {
  // Arrange
  const owner = await createNote(t)
  const intruder = await setup(t, 'user')
  const originalTitle = owner.note.data.title

  // Act
  const response = await intruder.app.inject({
    method: 'PUT',
    url: `/notes/${owner.note.data.id}`,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${intruder.accessToken}`,
    },
    payload: { title: 'intruder-update-attempt' },
  })

  // Assert
  assert.strictEqual(response.statusCode, 404)

  const ownerVerify = await owner.app.inject({
    method: 'GET',
    url: `/notes/${owner.note.data.id}`,
    headers: { Authorization: `Bearer ${owner.accessToken}` },
  })

  assert.strictEqual(ownerVerify.statusCode, 200)
  assert.strictEqual(ownerVerify.json().data.title, originalTitle)
})

test('PUT /notes/:id 400 - Invalid id format', async (t) => {
  // Arrange
  const { app, accessToken } = await createNote(t)

  // Act
  const response = await app.inject({
    method: 'PUT',
    url: `/notes/invalid-id-format`,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    payload: { title: randomString(10), body: randomString(20) },
  })

  // Assert
  assert.strictEqual(response.statusCode, 400)
})

test('PUT /notes/:id Partial Update - Valid Payload', async (t) => {
  // Arrange
  const { app, accessToken, note } = await createNote(t)
  const noteId = note.data.id

  // Act
  const response = await app.inject({
    method: 'PUT',
    url: `/notes/${noteId}`,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    payload: { body: randomString(25) },
  })

  // Assert
  assert.ok(
    [200, 400].includes(response.statusCode),
    `Expected 200 or 400, got ${response.statusCode}`
  )
})

test('PUT /notes/:id 401 - Unauthorized', async (t) => {
  // Arrange
  const { app, note } = await createNote(t)
  const noteId = note.data.id

  // Act
  const response = await app.inject({
    method: 'PUT',
    url: `/notes/${noteId}`,
    headers: { 'Content-Type': 'application/json' },
    payload: { title: randomString(10), body: randomString(20) }
  })

  // Assert
  assert.strictEqual(response.statusCode, 401)
})