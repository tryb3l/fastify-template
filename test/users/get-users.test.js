'use strict'

const t = require('tap')
const { setup } = require('../utils/setup-user')

t.beforeEach(async (t) => {
  const { app, accessToken, refreshToken } = await setup(t)
  t.context.app = app
  t.context.accessToken = accessToken
  t.context.refreshToken = refreshToken
})

t.test('GET /users 200 - List users', async (t) => {
  // Arrange
  const { app, accessToken, refreshToken } = t.context

  // Act
  const response = await app.inject({
    method: 'GET',
    url: '/users',
    headers: {
      contentType: 'application/json',
    },
    cookies: {
      accessToken: accessToken,
      refreshToken: refreshToken,
    },
  })

  // Assert
  t.equal(response.statusCode, 200)
  t.type(response.json(), 'object')
  t.ok(Array.isArray(response.json().data))
  t.type(response.json().totalCount, 'number')
})

t.test('GET /users 200 - List users with pagination', async (t) => {
  // Arrange
  const { app, accessToken, refreshToken } = t.context

  // Act
  const response = await app.inject({
    method: 'GET',
    url: '/users?skip=0&limit=5',
    headers: {
      contentType: 'application/json',
    },
    cookies: {
      accessToken: accessToken,
      refreshToken: refreshToken,
    },
  })

  // Assert
  t.equal(response.statusCode, 200)
  t.type(response.json(), 'object')
  t.ok(Array.isArray(response.json().data))
  t.type(response.json().totalCount, 'number')
  t.equal(response.json().data.length, 5)
})

t.test('GET /users 200 - List users with username filter', async (t) => {
  // Arrange
  const { app, accessToken, refreshToken } = t.context
  const username = 'testuser'

  // Act
  const response = await app.inject({
    method: 'GET',
    url: `/users?username=${username}`,
    headers: {
      contentType: 'application/json',
    },
    cookies: {
      accessToken: accessToken,
      refreshToken: refreshToken,
    },
  })

  // Assert
  t.equal(response.statusCode, 200)
  t.type(response.json(), 'object')
  t.ok(Array.isArray(response.json().data))
  t.type(response.json().totalCount, 'number')
  t.ok(response.json().data.every((user) => user.username === username))
})

t.test('GET /users 400 - Invalid skip and limit', async (t) => {
  // Arrange
  const { app, accessToken, refreshToken } = t.context

  // Act
  const response = await app.inject({
    method: 'GET',
    url: '/users?skip=-1&limit=-5',
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

t.test('GET /users 401 - Unauthorized', async (t) => {
  // Arrange
  const { app } = t.context

  // Act
  const response = await app.inject({
    method: 'GET',
    url: '/users',
    headers: {
      contentType: 'application/json',
    },
  })

  // Assert
  t.equal(response.statusCode, 401)
  t.type(response.json(), 'object')
})

t.test('GET /users 404 - User not found', async (t) => {
  // Arrange
  const { app, accessToken, refreshToken } = t.context

  // Act
  const response = await app.inject({
    method: 'GET',
    url: '/users/123456',
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
  t.equal(response.json().error, 'User not found')
})
