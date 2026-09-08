'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { randomUUIDv7 } = require('node:crypto')
const { createNote } = require('../../../../utils/note-creator')
const { randomString } = require('../../../../utils/data-creator')
const { setup } = require('../../../../utils/setup-user')
const { buildMarkdownNote } = require('../../../../utils/markdown-note')

test('PUT /notes/:id 200 - Update a note', async (t) => {
  // Arrange
  const { app, accessToken, note } = await createNote(t)
  const noteId = note.data.id

  const updatedNote = {
    title: randomString(15),
    body: randomString(30),
    tags: [randomString(5), randomString(5)],
    expectedRevision: note.data.revision,
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
  assert.strictEqual(payload.data.revision, note.data.revision + 1)
})

test('PUT /notes/:id 409 - Rejects stale saves without overwriting the latest note', async (t) => {
  // Arrange
  const { app, accessToken, note } = await createNote(t)
  const noteId = note.data.id
  const initialRevision = note.data.revision
  const firstUpdate = {
    title: 'First persisted edit',
    body: 'First body change',
    tags: ['first'],
    expectedRevision: initialRevision,
  }
  const staleUpdate = {
    title: 'Stale edit attempt',
    body: 'Second body change',
    tags: ['stale'],
    expectedRevision: initialRevision,
  }

  // Act
  const firstResponse = await app.inject({
    method: 'PUT',
    url: `/notes/${noteId}`,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    payload: firstUpdate,
  })

  const staleResponse = await app.inject({
    method: 'PUT',
    url: `/notes/${noteId}`,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    payload: staleUpdate,
  })

  const readResponse = await app.inject({
    method: 'GET',
    url: `/notes/${noteId}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  assert.strictEqual(firstResponse.statusCode, 200)
  assert.strictEqual(staleResponse.statusCode, 409)
  assert.strictEqual(readResponse.statusCode, 200)
  assert.strictEqual(staleResponse.json().code, 'NOTE_STALE_SAVE')
  assert.strictEqual(
    staleResponse.json().message,
    'Note was modified elsewhere. Reload the latest note before saving again.',
  )
  assert.strictEqual(staleResponse.json().currentRevision, firstResponse.json().data.revision)
  assert.strictEqual(staleResponse.json().currentModifiedAt, firstResponse.json().data.modifiedAt)
  assert.strictEqual(readResponse.json().data.title, firstUpdate.title)
  assert.strictEqual(readResponse.json().data.body, firstUpdate.body)
  assert.deepStrictEqual(readResponse.json().data.tags, firstUpdate.tags)
  assert.strictEqual(readResponse.json().data.revision, initialRevision + 1)
})

test('PUT /notes/:id 200 - Updates a note with a large markdown body', async (t) => {
  // Arrange
  const { app, accessToken, note } = await createNote(t)
  const noteId = note.data.id
  const markdownBody = buildMarkdownNote({ minLength: 32000 })
  const updatedNote = {
    title: 'Milkdown updated note',
    body: markdownBody,
    tags: ['markdown', 'updated'],
    expectedRevision: note.data.revision,
  }

  // Act
  const updateResponse = await app.inject({
    method: 'PUT',
    url: `/notes/${noteId}`,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    payload: updatedNote,
  })

  const readResponse = await app.inject({
    method: 'GET',
    url: `/notes/${noteId}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  assert.strictEqual(updateResponse.statusCode, 200)
  assert.strictEqual(readResponse.statusCode, 200)
  assert.strictEqual(updateResponse.json().data.body, markdownBody)
  assert.strictEqual(readResponse.json().data.body, markdownBody)
  assert.deepStrictEqual(readResponse.json().data.tags, updatedNote.tags)
})

test('PUT /notes/:id 200 - Accepts a note body at the 50000 character limit', async (t) => {
  // Arrange
  const { app, accessToken, note } = await createNote(t)
  const noteId = note.data.id
  const updatedBody = 'b'.repeat(50000)

  // Act
  const updateResponse = await app.inject({
    method: 'PUT',
    url: `/notes/${noteId}`,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    payload: {
      title: 'Boundary update accepted',
      body: updatedBody,
      tags: ['boundary', 'accepted'],
      expectedRevision: note.data.revision,
    },
  })

  const readResponse = await app.inject({
    method: 'GET',
    url: `/notes/${noteId}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  assert.strictEqual(updateResponse.statusCode, 200)
  assert.strictEqual(readResponse.statusCode, 200)
  assert.strictEqual(readResponse.json().data.body, updatedBody)
})

test('PUT /notes/:id 400 - Rejects a note body above the 50000 character limit without changing the note', async (t) => {
  // Arrange
  const { app, accessToken, note } = await createNote(t)
  const noteId = note.data.id
  const originalBody = note.data.body

  // Act
  const updateResponse = await app.inject({
    method: 'PUT',
    url: `/notes/${noteId}`,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    payload: {
      title: 'Boundary update rejected',
      body: 'b'.repeat(50001),
      tags: ['boundary', 'rejected'],
      expectedRevision: note.data.revision,
    },
  })

  const readResponse = await app.inject({
    method: 'GET',
    url: `/notes/${noteId}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  assert.strictEqual(updateResponse.statusCode, 400)
  assert.strictEqual(readResponse.statusCode, 200)
  assert.strictEqual(readResponse.json().data.body, originalBody)
})

test('PUT /notes/:id 200 - Invalidates cached note reads after update', async (t) => {
  // Arrange
  const { app, accessToken, note } = await createNote(t)
  const noteId = note.data.id
  const updatedNote = {
    title: randomString(15),
    body: randomString(30),
    tags: [randomString(5), randomString(5)],
    expectedRevision: note.data.revision,
  }

  const cachedReadResponse = await app.inject({
    method: 'GET',
    url: `/notes/${noteId}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  assert.strictEqual(cachedReadResponse.statusCode, 200)
  assert.strictEqual(cachedReadResponse.json().data.title, note.data.title)

  // Act
  const updateResponse = await app.inject({
    method: 'PUT',
    url: `/notes/${noteId}`,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    payload: updatedNote,
  })

  const refreshedReadResponse = await app.inject({
    method: 'GET',
    url: `/notes/${noteId}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  assert.strictEqual(updateResponse.statusCode, 200)
  assert.strictEqual(refreshedReadResponse.statusCode, 200)
  assert.strictEqual(refreshedReadResponse.json().data.title, updatedNote.title)
  assert.strictEqual(refreshedReadResponse.json().data.body, updatedNote.body)
  assert.deepStrictEqual(refreshedReadResponse.json().data.tags, updatedNote.tags)
})

test('PUT /notes/:id 404 - Note not found', async (t) => {
  // Arrange
  const { app, accessToken } = await createNote(t)
  const nonExistentNoteId = randomUUIDv7()

  // Act
  const response = await app.inject({
    method: 'PUT',
    url: `/notes/${nonExistentNoteId}`,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    payload: { title: randomString(10), body: randomString(20), expectedRevision: 1 },
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
    payload: { title: 'intruder-update-attempt', expectedRevision: owner.note.data.revision },
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
  const { app, accessToken, note } = await createNote(t)

  // Act
  const response = await app.inject({
    method: 'PUT',
    url: `/notes/invalid-id-format`,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    payload: {
      title: randomString(10),
      body: randomString(20),
      expectedRevision: note.data.revision,
    },
  })

  // Assert
  assert.strictEqual(response.statusCode, 400)
})

test('PUT /notes/:id Partial Update - Valid Payload', async (t) => {
  // Arrange
  const { app, accessToken, note } = await createNote(t)
  const noteId = note.data.id
  const renamedTitle = randomString(18)

  // Act
  const updateResponse = await app.inject({
    method: 'PUT',
    url: `/notes/${noteId}`,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    payload: { title: renamedTitle, expectedRevision: note.data.revision },
  })

  const readResponse = await app.inject({
    method: 'GET',
    url: `/notes/${noteId}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  assert.strictEqual(updateResponse.statusCode, 200)
  assert.strictEqual(readResponse.statusCode, 200)
  assert.strictEqual(readResponse.json().data.title, renamedTitle)
  assert.strictEqual(readResponse.json().data.body, note.data.body)
})

test('PUT /notes/:id 200 - Accepts an explicitly empty body', async (t) => {
  // Arrange
  const { app, accessToken, note } = await createNote(t)
  const noteId = note.data.id

  // Act
  const updateResponse = await app.inject({
    method: 'PUT',
    url: `/notes/${noteId}`,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    payload: { body: '', expectedRevision: note.data.revision },
  })

  const readResponse = await app.inject({
    method: 'GET',
    url: `/notes/${noteId}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  assert.strictEqual(updateResponse.statusCode, 200)
  assert.strictEqual(readResponse.statusCode, 200)
  assert.strictEqual(updateResponse.json().data.body, '')
  assert.strictEqual(readResponse.json().data.body, '')
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
    payload: { title: randomString(10), body: randomString(20) },
  })

  // Assert
  assert.strictEqual(response.statusCode, 401)
})

test('PUT /notes/:id 400 - Rejects updates missing expectedRevision', async (t) => {
  // Arrange
  const { app, accessToken, note } = await createNote(t)
  const noteId = note.data.id

  // Act
  const response = await app.inject({
    method: 'PUT',
    url: `/notes/${noteId}`,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    payload: { title: randomString(10), body: randomString(20) },
  })

  const readResponse = await app.inject({
    method: 'GET',
    url: `/notes/${noteId}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  assert.strictEqual(response.statusCode, 400)
  assert.strictEqual(readResponse.statusCode, 200)
  assert.strictEqual(readResponse.json().data.title, note.data.title)
})

test('PUT /notes/:id concurrent updates - exactly one write wins and revision increments once', async (t) => {
  // Arrange
  const { app, accessToken, note } = await createNote(t)
  const noteId = note.data.id
  const initialRevision = note.data.revision
  const updateA = {
    title: 'Concurrent update A',
    body: 'Body from writer A',
    tags: ['writer-a'],
    expectedRevision: initialRevision,
  }
  const updateB = {
    title: 'Concurrent update B',
    body: 'Body from writer B',
    tags: ['writer-b'],
    expectedRevision: initialRevision,
  }

  // Act
  const [responseA, responseB] = await Promise.all([
    app.inject({
      method: 'PUT',
      url: `/notes/${noteId}`,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      payload: updateA,
    }),
    app.inject({
      method: 'PUT',
      url: `/notes/${noteId}`,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      payload: updateB,
    }),
  ])

  const readResponse = await app.inject({
    method: 'GET',
    url: `/notes/${noteId}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  const statusCodes = [responseA.statusCode, responseB.statusCode].sort()
  assert.deepStrictEqual(statusCodes, [200, 409])

  const [winningResponse, losingResponse] =
    responseA.statusCode === 200 ? [responseA, responseB] : [responseB, responseA]
  const winningUpdate = responseA.statusCode === 200 ? updateA : updateB

  assert.strictEqual(losingResponse.json().code, 'NOTE_STALE_SAVE')
  assert.strictEqual(losingResponse.json().currentRevision, winningResponse.json().data.revision)
  assert.strictEqual(winningResponse.json().data.revision, initialRevision + 1)
  assert.strictEqual(readResponse.json().data.revision, initialRevision + 1)
  assert.strictEqual(readResponse.json().data.title, winningUpdate.title)
  assert.strictEqual(readResponse.json().data.body, winningUpdate.body)
})
