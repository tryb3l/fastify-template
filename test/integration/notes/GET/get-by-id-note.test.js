'use strict'

const t = require('tap')
const { setup } = require('../../../utils/setup-user')
const { randomString } = require('../../../utils/data-creator')
const { randomUUID } = require('node:crypto')

const noteTitle = randomString(10)
const noteBody = randomString(20)
const noteTags = [randomString(5)]

t.beforeEach(async (t) => {
  const { app, accessToken, refreshToken } = await setup(t)
  t.context.app = app
  t.context.accessToken = accessToken
  t.context.refreshToken = refreshToken
})

t.test('GET by id /notes/:id 200 - Fetch note by id', async (t) => {
  // Arrange
  const { app, accessToken, refreshToken } = t.context

  // Create a note
  const createResponse = await app.inject({
    method: 'POST',
    url: '/notes/',
    headers: {
      contentType: 'application/json',
    },
    cookies: {
      accessToken: accessToken,
      refreshToken: refreshToken,
    },
    payload: {
      title: noteTitle,
      body: noteBody,
      tags: noteTags,
    },
  })

  t.equal(createResponse.statusCode, 201)
  t.type(createResponse.json(), 'object')
  t.ok(createResponse.json().id)
  const noteId = createResponse.json().id

  // Act
  const responseGet = await app.inject({
    method: 'GET',
    url: `/notes/${noteId}`,
    headers: {
      contentType: 'application/json',
    },
    cookies: {
      accessToken: accessToken,
      refreshToken: refreshToken,
    },
  })

  // Assert
  t.equal(responseGet.statusCode, 200)
  t.type(responseGet.json(), 'object')
  t.equal(responseGet.json().data.id, noteId)
  t.equal(responseGet.json().data.title, noteTitle)
  t.equal(responseGet.json().data.body, noteBody)
  t.same(responseGet.json().data.tags, noteTags)
})

t.test('GET by id /notes/:id 404 - Note not found', async (t) => {
  // Arrange
  const { app, accessToken, refreshToken } = t.context
  const nonExistentNoteId = randomUUID()

  // Act
  const response = await app.inject({
    method: 'GET',
    url: `/notes/${nonExistentNoteId}`,
    headers: {
      contentType: 'application/json',
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
  const { app, accessToken, refreshToken } = t.context
  const invalidNoteId = 'invalid-id'

  // Act
  const response = await app.inject({
    method: 'GET',
    url: `/notes/${invalidNoteId}`,
    headers: {
      contentType: 'application/json',
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
