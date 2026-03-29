'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { setup } = require('../../../utils/setup-user')

test('Auth Architectural Extraction - Strictly Header-Only model', async (t) => {
  // Arrange
  const { app, accessToken } = await setup(t, 'user')
  const maliciousCookieHeader = `accessToken=${accessToken}`

  // Act (Attempt to inject cookie on protected route)
  const cookieInjectResponse = await app.inject({
    method: 'GET',
    url: '/users/me',
    headers: { cookie: maliciousCookieHeader }
  })

  // Assert
  assert.strictEqual(cookieInjectResponse.statusCode, 401, 'API must reject accessTokens supplied via cookies to protect against CSRF architectures')

  // Act (Standard Bearer Injection)
  const validHeaderResponse = await app.inject({
    method: 'GET',
    url: '/users/me',
    headers: { Authorization: `Bearer ${accessToken}` }
  })

  // Assert
  assert.strictEqual(validHeaderResponse.statusCode, 200, 'API must accept generic Bearer tokens inside the explicit Authorization header')
})
