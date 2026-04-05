'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { createNote } = require('../../../../utils/note-creator')
const { setup } = require('../../../../utils/setup-user')

test('GET /notes 200 - List notes', async (t) => {
  // Arrange
  const { app, accessToken } = await createNote(t)

  // Act
  const response = await app.inject({
    method: 'GET',
    url: '/notes',
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  assert.strictEqual(response.statusCode, 200)
  const payload = response.json()
  assert.ok(Array.isArray(payload.data))
  assert.strictEqual(payload.data.length, 1)
  assert.strictEqual(payload.totalCount, 1)
})

test('GET /notes 200 - List notes with pagination', async (t) => {
  // Arrange
  const { app, accessToken } = await createNote(t)
  await app.inject({
    method: 'POST',
    url: '/notes',
    payload: { title: 'Second Note', body: 'Second Body' },
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Act
  const response = await app.inject({
    method: 'GET',
    url: '/notes?skip=0&limit=1',
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  assert.strictEqual(response.statusCode, 200)
  const payload = response.json()
  assert.ok(Array.isArray(payload.data))
  assert.strictEqual(payload.data.length, 1, 'Should respect the limit of 1')
  assert.strictEqual(payload.totalCount, 2, 'Should return total amount of records despite limit')
})

test('GET /notes 200 - Filter notes by title', async (t) => {
  // Arrange
  const { app, accessToken, note } = await createNote(t)

  // Act
  const response = await app.inject({
    method: 'GET',
    url: `/notes?title=${encodeURIComponent(note.data.title)}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  assert.strictEqual(response.statusCode, 200)
  const payload = response.json()
  assert.ok(Array.isArray(payload.data))
  assert.strictEqual(payload.data[0].title, note.data.title)
  assert.strictEqual(payload.totalCount, 1)
})

test('GET /notes 400 - Invalid skip and limit (negative values)', async (t) => {
  // Arrange
  const { app, accessToken } = await setup(t, 'user')

  // Act
  const response = await app.inject({
    method: 'GET',
    url: '/notes?skip=-1&limit=-5',
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  assert.strictEqual(response.statusCode, 400)
})

test('GET /notes 400 - Invalid skip and limit (exceeds maximum)', async (t) => {
  // Arrange
  const { app, accessToken } = await setup(t, 'user')

  // Act
  const response = await app.inject({
    method: 'GET',
    url: '/notes?skip=101&limit=101',
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  assert.strictEqual(response.statusCode, 400)
})

test('GET /notes 401 - Unauthorized', async (t) => {
  // Arrange
  const { app } = await setup(t, 'user')

  // Act
  const response = await app.inject({
    method: 'GET',
    url: '/notes',
  })

  // Assert
  assert.strictEqual(response.statusCode, 401)
})