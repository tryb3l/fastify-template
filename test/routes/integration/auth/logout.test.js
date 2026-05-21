'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { setup } = require('../../../utils/setup-user')
const { buildRefreshTokenCookieHeader, issueCsrfContext } = require('../../../utils/csrf')

function findRefreshCookie(setCookieHeader) {
  const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader]
  return cookies.find((cookie) => cookie && cookie.startsWith('refreshToken='))
}

test('POST /auth/logout 204 - Successfully clears token session', async (t) => {
  // Arrange
  const { app, refreshToken } = await setup(t, 'user')
  const { csrfToken, csrfCookieHeader } = await issueCsrfContext(app)
  const cookieHeader = buildRefreshTokenCookieHeader(refreshToken, csrfCookieHeader)

  // Act
  const logoutResponse = await app.inject({
    method: 'POST',
    url: '/auth/logout',
    headers: {
      cookie: cookieHeader,
      'x-csrf-token': csrfToken,
    },
  })

  const clearCookie = findRefreshCookie(logoutResponse.headers['set-cookie'])

  // Assert
  assert.strictEqual(logoutResponse.statusCode, 204)
  assert.ok(clearCookie, 'Refresh token cookie directive should be present')
  assert.ok(
    clearCookie.includes('Max-Age=0') || clearCookie.includes('Expires='),
    'Cookie should be explicitly expired',
  )
  assert.ok(clearCookie.includes('Path=/auth'), 'Clear cookie should match /auth path')

  // Act
  const refreshResponse = await app.inject({
    method: 'POST',
    url: '/auth/refresh',
    headers: {
      cookie: cookieHeader,
      'x-csrf-token': csrfToken,
    },
  })

  // Assert
  assert.strictEqual(
    refreshResponse.statusCode,
    401,
    'Logged out tokens must be rejected natively by the cache/rotation store',
  )
})

test('POST /auth/logout 401 - Rejects access tokens supplied via the refreshToken cookie', async (t) => {
  // Arrange
  const { app, accessToken } = await setup(t, 'user')
  const { csrfToken, csrfCookieHeader } = await issueCsrfContext(app)
  const cookieHeader = buildRefreshTokenCookieHeader(accessToken, csrfCookieHeader)

  // Act
  const response = await app.inject({
    method: 'POST',
    url: '/auth/logout',
    headers: {
      cookie: cookieHeader,
      'x-csrf-token': csrfToken,
    },
  })

  // Assert
  assert.strictEqual(response.statusCode, 401)
})
