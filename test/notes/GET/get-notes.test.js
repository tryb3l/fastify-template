'use strict'

const t = require('tap')
const { setup } = require('../../utils/setup-user')
const { randomString } = require('../../utils/data-creator')

t.beforeEach(async (t) => {
  const { app, accessToken, refreshToken } = await setup(t)
  t.context.app = app
  t.context.accessToken = accessToken
  t.context.refreshToken = refreshToken

  // Create a note before each test
  const noteTitle = randomString(10)
  const noteBody = randomString(20)
  const noteTags = [randomString(5)]

  const response = await app.inject({
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

  t.equal(response.statusCode, 201)
  t.type(response.json(), 'object')
  t.ok(response.json().id)
  t.equal(typeof response.json().id, 'string')

  t.context.noteId = response.json().id
})

t.test('GET /notes 200 - List notes', async (t) => {
  // Arrange
  const { app, accessToken, refreshToken } = t.context

  // Act
  const response = await app.inject({
    method: 'GET',
    url: '/notes',
    headers: {
      contentType: 'application/json',
    },
    cookies: {
      accessToken: accessToken,
      refreshToken: refreshToken,
    },
  })

  // Assert
  t.equal(response.statusCode, 201)
  t.type(response.json(), 'object')
  t.ok(Array.isArray(response.json().data))
  t.type(response.json().totalCount, 'number')
})

t.test('GET /notes 200 - List notes with pagination', async (t) => {
  // Arrange
  const { app, accessToken, refreshToken } = t.context

  // Act
  const response = await app.inject({
    method: 'GET',
    url: '/notes?skip=0&limit=3',
    headers: {
      contentType: 'application/json',
    },
    cookies: {
      accessToken: accessToken,
      refreshToken: refreshToken,
    },
  })

  // Assert
  t.equal(response.statusCode, 201)
  t.type(response.json(), 'object')
  t.ok(Array.isArray(response.json().data))
  t.type(response.json().totalCount, 'number')
  t.equal(response.json().data.length, 3)
})

t.test('GET /notes 200 - List notes with title filter', async (t) => {
  // Arrange
  const { app, accessToken, refreshToken } = t.context
  const title = 'testnote'

  // Act
  const response = await app.inject({
    method: 'GET',
    url: `/notes?title=${title}`,
    headers: {
      contentType: 'application/json',
    },
    cookies: {
      accessToken: accessToken,
      refreshToken: refreshToken,
    },
  })

  // Assert
  t.equal(response.statusCode, 201)
  t.type(response.json(), 'object')
  t.ok(Array.isArray(response.json().data))
  t.type(response.json().totalCount, 'number')
  t.ok(response.json().data.every((note) => note.title.includes(title)))
})

t.test('GET /notes 400 - Invalid skip and limit', async (t) => {
  // Arrange
  const { app, accessToken, refreshToken } = t.context

  // Act
  const response = await app.inject({
    method: 'GET',
    url: '/notes?skip=-1&limit=-5',
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
  t.equal(response.json().message, 'Skip and limit must be non-negative integers')
})

t.test('GET /notes 401 - Unauthorized', async (t) => {
  // Arrange
  const { app } = t.context

  // Act
  const response = await app.inject({
    method: 'GET',
    url: '/notes',
    headers: {
      contentType: 'application/json',
    },
  })

  // Assert
  t.equal(response.statusCode, 401)
  t.type(response.json(), 'object')
})
