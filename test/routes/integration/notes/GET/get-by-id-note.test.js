'use strict'

const t = require('tap')
const { createNote } = require('../../../../utils/note-creator')
const { randomString } = require('../../../../utils/data-creator')
const { randomUUID } = require('node:crypto')

t.test('GET by id /notes/:id 200 - Fetch note by id', async (t) => {
  // Arrange
  const { note, app, accessToken, refreshToken } = await createNote(t)

  // Act
  const response = await app.inject({
    method: 'GET',
    url: `/notes/${note.id}`,
    headers: {
      'Content-Type': 'application/json',
    },
    cookies: {
      accessToken: accessToken,
      refreshToken: refreshToken,
    },
  })

  // Assert
  t.equal(response.statusCode, 200)
  t.type(response.json(), 'object')
  t.equal(response.json().data.id, note.id)
  t.equal(response.json().data.title, note.title)
  t.equal(response.json().data.body, note.body)
  t.same(response.json().data.tags, note.tags)
  t.equal(response.json().data.createdAt, note.createdAt)
  t.equal(response.json().data.updatedAt, note.updatedAt)
})

t.test('GET by id /notes/:id 404 - Note not found', async (t) => {
  // Arrange
  const { app, accessToken, refreshToken } = await createNote(t)
  const nonExistentNoteId = randomUUID()

  // Act
  const response = await app.inject({
    method: 'GET',
    url: `/notes/${nonExistentNoteId}`,
    headers: {
      'Content-Type': 'application/json',
    },
    cookies: {
      accessToken: accessToken,
      refreshToken: refreshToken,
    },
  })

  // Assert
  t.equal(response.statusCode, 404)
  t.type(response.json(), 'object')
})

t.test('GET by id /notes/:id 400 - Invalid id format', async (t) => {
  // Arrange
  const { app, accessToken, refreshToken } = await createNote(t)
  const invalidNoteId = randomString('1234567890', 10)

  // Act
  const response = await app.inject({
    method: 'GET',
    url: `/notes/${invalidNoteId}`,
    headers: {
      'Content-Type': 'application/json',
    },
    cookies: {
      accessToken: accessToken,
      refreshToken: refreshToken,
    },
  })

  // Assert
  t.equal(response.statusCode, 400)
  t.type(response.json(), 'object')
})

t.test('GET by id /notes/:id 401 - Unauthorized', async (t) => {
  // Arrange
  const { app } = await createNote(t)
  const nonExistentNoteId = randomUUID()
  const accessToken = 'invalid'
  const refreshToken = 'invalid'

  // Act
  const response = await app.inject({
    method: 'GET',
    url: `/notes/${nonExistentNoteId}`,
    headers: {
      'Content-Type': 'application/json',
    },
    cookies: {
      accessToken: accessToken,
      refreshToken: refreshToken,
    },
  })

  // Assert
  t.equal(response.statusCode, 401)
  t.type(response.json(), 'object')
})

t.test('GET by id /notes/:id 404 - Note not found', async (t) => {
  // Arrange
  const { app, accessToken, refreshToken } = await createNote(t)
  const nonExistentNoteId = randomUUID()

  // Act
  const response = await app.inject({
    method: 'GET',
    url: `/notes/${nonExistentNoteId}`,
    headers: {
      'Content-Type': 'application/json',
    },
    cookies: {
      accessToken: accessToken,
      refreshToken: refreshToken,
    },
  })

  // Assert
  t.equal(response.statusCode, 404)
  t.type(response.json(), 'object')
})
