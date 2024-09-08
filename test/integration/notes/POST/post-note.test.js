'use strict'

const t = require('tap')
const { setup } = require('../../../utils/setup-user')
const { randomString } = require('../../../utils/data-creator')

t.beforeEach(async (t) => {
  const { app, accessToken, refreshToken } = await setup(t)
  t.context.app = app
  t.context.accessToken = accessToken
  t.context.refreshToken = refreshToken
})

const noteTitle = randomString(10)
const noteBody = randomString(20)
const noteTags = [randomString(5)]

t.test('POST /notes 201 - Create a new note', async (t) => {
  // Arrange
  const { app, accessToken, refreshToken } = t.context

  // Act
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

  // Assert
  t.equal(response.statusCode, 201)
  t.type(response.json(), 'object')
  t.ok(response.json().id)
  t.equal(typeof response.json().id, 'string')
})

t.test('POST /notes 400 - Missing title', async (t) => {
  // Arrange
  const { app, accessToken, refreshToken } = t.context

  // Act
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
      body: noteBody,
      tags: noteTags,
    },
  })

  // Assert
  t.equal(response.statusCode, 400)
  t.type(response.json(), 'object')
  t.equal(response.json().message, "body must have required property 'title'")
})

t.test('POST /notes 400 - Missing body', async (t) => {
  // Arrange
  const { app, accessToken, refreshToken } = t.context

  // Act
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
      tags: noteTags,
    },
  })

  // Assert
  t.equal(response.statusCode, 400)
  t.type(response.json(), 'object')
  t.equal(response.json().message, "body must have required property 'body'")
})

t.test('POST /notes 400 - Title too short', async (t) => {
  // Arrange
  const { app, accessToken, refreshToken } = t.context

  // Act
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
      title: '',
      body: noteBody,
      tags: noteTags,
    },
  })

  // Assert
  t.equal(response.statusCode, 400)
  t.type(response.json(), 'object')
  t.equal(response.json().message, 'body/title must NOT have fewer than 1 characters')
})

t.test('POST /notes 400 - Title too long', async (t) => {
  // Arrange
  const { app, accessToken, refreshToken } = t.context
  const longTitle = randomString(101)

  // Act
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
      title: longTitle,
      body: noteBody,
      tags: noteTags,
    },
  })

  // Assert
  t.equal(response.statusCode, 400)
  t.type(response.json(), 'object')
  t.equal(response.json().message, 'body/title must NOT have more than 100 characters')
})

t.test('POST /notes 400 - Body too short', async (t) => {
  // Arrange
  const { app, accessToken, refreshToken } = t.context

  // Act
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
      body: '',
      tags: noteTags,
    },
  })

  // Assert
  t.equal(response.statusCode, 400)
  t.type(response.json(), 'object')
  t.equal(response.json().message, 'body/body must NOT have fewer than 1 characters')
})

t.test('POST /notes 400 - Body too long', async (t) => {
  // Arrange
  const { app, accessToken, refreshToken } = t.context
  const longBody = randomString(10001)

  // Act
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
      body: longBody,
      tags: noteTags,
    },
  })

  // Assert
  t.equal(response.statusCode, 400)
  t.type(response.json(), 'object')
  t.equal(response.json().message, 'body/body must NOT have more than 10000 characters')
})

t.test('POST /notes 400 - Invalid tags', async (t) => {
  // Arrange
  const { app, accessToken, refreshToken } = t.context
  const invalidTags = [randomString(11)]

  // Act
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
      tags: invalidTags,
    },
  })

  // Assert
  t.equal(response.statusCode, 400)
  t.type(response.json(), 'object')
  t.equal(response.json().message, 'body/tags/0 must NOT have more than 10 characters')
})
