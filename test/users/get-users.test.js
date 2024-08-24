'use strict'

const t = require('tap')
const { setup } = require('../utils/setup-user')

t.beforeEach(async (t) => {
  const { app, accessToken, refreshToken } = await setup(t)
  t.context.app = app
  t.context.accessToken = accessToken
  t.context.refreshToken = refreshToken
})

t.test('GET /users 200', async (t) => {
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
})

t.test('GET /users 401', async (t) => {
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

t.test('GET /users 404', async (t) => {
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
})
