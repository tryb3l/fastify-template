'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { setup } = require('../../../utils/setup-user')
const {
  buildRefreshTokenCookieHeader,
  getCookiePair,
  issueCsrfContext,
} = require('../../../utils/csrf')

test('POST /auth/refresh 403 - Requires a CSRF token', async (t) => {
  // Arrange
  const { app, refreshToken } = await setup(t, 'user')
  const cookieHeader = `refreshToken=${refreshToken}`

  // Act
  const response = await app.inject({
    method: 'POST',
    url: '/auth/refresh',
    headers: { cookie: cookieHeader },
  })

  // Assert
  assert.strictEqual(response.statusCode, 403, 'Refresh without CSRF token must fail natively')
})

test('POST /auth/logout 403 - Requires a CSRF token', async (t) => {
  // Arrange
  const { app, refreshToken } = await setup(t, 'user')
  const cookieHeader = `refreshToken=${refreshToken}`

  // Act
  const response = await app.inject({
    method: 'POST',
    url: '/auth/logout',
    headers: { cookie: cookieHeader },
  })

  // Assert
  assert.strictEqual(response.statusCode, 403, 'Logout without CSRF token must fail natively')
})

test('GET /auth/csrf 200 - Issues a CSRF token', async (t) => {
  // Arrange
  const { app } = await setup(t, 'user')

  // Act
  const response = await app.inject({
    method: 'GET',
    url: '/auth/csrf',
  })

  // Assert
  assert.strictEqual(response.statusCode, 200)
  assert.ok(response.json().csrfToken, 'Should successfully issue a CSRF generation payload')
  assert.ok(getCookiePair(response.headers['set-cookie']))
})

test('POST /auth/refresh 403 - Rejects an invalid CSRF token', async (t) => {
  // Arrange
  const { app, refreshToken } = await setup(t, 'user')
  const { csrfCookieHeader } = await issueCsrfContext(app)
  const cookieHeader = buildRefreshTokenCookieHeader(refreshToken, csrfCookieHeader)

  // Act
  const response = await app.inject({
    method: 'POST',
    url: '/auth/refresh',
    headers: {
      cookie: cookieHeader,
      'x-csrf-token': 'invalid-token-signature-attempt',
    },
  })

  // Assert
  assert.strictEqual(response.statusCode, 403, 'Refresh with invalid CSRF token must fail natively')
})
