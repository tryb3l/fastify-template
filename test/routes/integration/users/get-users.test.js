'use strict'

const t = require('tap')
const { setup } = require('../../../utils/setup-user')

t.test('GET /users - Admin user can list users', async (t) => {
  const { app, accessToken } = await setup(t, 'admin')

  const response = await app.inject({
    method: 'GET',
    url: '/users',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  t.equal(response.statusCode, 200)
  t.type(response.json(), 'object')
  t.ok(Array.isArray(response.json().data))
})

t.skip('GET /users 200 - List users with pagination', async (t) => {
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

t.skip('GET /users 200 - List users with username filter', async (t) => {
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

t.skip('GET /users 400 - Invalid skip and limit', async (t) => {
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

t.skip('GET /users 401 - Unauthorized', async (t) => {
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

t.skip('GET /users 404 - User not found', async (t) => {
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
  t.equal(response.json().error, 'Not Found')
})

t.test('GET /users - Regular user receives 403 Forbidden', async (t) => {
  const { app, accessToken } = await setup(t, 'user')

  const response = await app.inject({
    method: 'GET',
    url: '/users',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  t.equal(response.statusCode, 403)
  t.same(response.json(), {
    statusCode: 403,
    error: 'Forbidden',
    message: 'Insufficient permissions',
  })
})
