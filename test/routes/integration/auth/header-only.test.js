'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { setup } = require('../../../utils/setup-user')

test('GET /users/me 401 - Rejects access tokens supplied via cookies', async (t) => {
  // Arrange
  const { app, accessToken } = await setup(t, 'user')
  const maliciousCookieHeader = `accessToken=${accessToken}`

  // Act
  const response = await app.inject({
    method: 'GET',
    url: '/users/me',
    headers: { cookie: maliciousCookieHeader },
  })

  // Assert
  assert.strictEqual(
    response.statusCode,
    401,
    'API must reject accessTokens supplied via cookies to protect against CSRF architectures',
  )
})

test('GET /users/me 200 - Accepts access tokens in the Authorization header', async (t) => {
  // Arrange
  const { app, accessToken } = await setup(t, 'user')

  // Act
  const response = await app.inject({
    method: 'GET',
    url: '/users/me',
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  assert.strictEqual(
    response.statusCode,
    200,
    'API must accept generic Bearer tokens inside the explicit Authorization header',
  )
})

test('GET /users/me 401 - Rejects refresh tokens in the Authorization header', async (t) => {
  // Arrange
  const { app, refreshToken } = await setup(t, 'user')

  // Act
  const response = await app.inject({
    method: 'GET',
    url: '/users/me',
    headers: { Authorization: `Bearer ${refreshToken}` },
  })

  // Assert
  assert.strictEqual(
    response.statusCode,
    401,
    'API must reject refresh tokens supplied as Bearer credentials on protected routes',
  )
})
