'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { MongoClient } = require('mongodb')
const { setup } = require('../../../utils/setup-user')
const { buildRefreshTokenCookieHeader, issueCsrfContext } = require('../../../utils/csrf')

function findRefreshCookie(setCookieHeader) {
  const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader]
  return cookies.find((cookie) => cookie && cookie.startsWith('refreshToken='))
}

function assertRefreshCookieExpired(setCookieHeader) {
  const clearCookie = findRefreshCookie(setCookieHeader)

  assert.ok(clearCookie, 'Refresh token clear directive should be present')
  assert.ok(
    clearCookie.includes('Max-Age=0') || clearCookie.includes('Expires='),
    'Refresh token cookie should be explicitly expired',
  )
  assert.ok(clearCookie.includes('Path=/auth'), 'Refresh token clear path should match /auth')
}

test('POST /auth/refresh 200 - Successfully rotates tokens with valid CSRF', async (t) => {
  // Arrange
  const { app, refreshToken } = await setup(t, 'user')
  const { csrfToken, csrfCookieHeader } = await issueCsrfContext(app)
  const originalRefreshCookieHeader = buildRefreshTokenCookieHeader(refreshToken, csrfCookieHeader)

  // Act
  const refreshResponse = await app.inject({
    method: 'POST',
    url: '/auth/refresh',
    headers: {
      cookie: originalRefreshCookieHeader,
      'x-csrf-token': csrfToken,
    },
  })

  const body = refreshResponse.json()
  const newRefreshCookie = findRefreshCookie(refreshResponse.headers['set-cookie'])

  // Assert
  assert.strictEqual(refreshResponse.statusCode, 200)
  assert.ok(body.access_token, 'New Access Token should be returned')
  assert.strictEqual(body.token_type, 'Bearer')

  assert.ok(newRefreshCookie, 'New Refresh token cookie should be set')
  const newRefreshToken = newRefreshCookie.split(';')[0].split('=')[1]
  assert.notStrictEqual(newRefreshToken, refreshToken, 'Refresh token should rotate')

  // Act
  const oldRefreshResponse = await app.inject({
    method: 'POST',
    url: '/auth/refresh',
    headers: {
      cookie: originalRefreshCookieHeader,
      'x-csrf-token': csrfToken,
    },
  })

  // Assert
  assert.strictEqual(
    oldRefreshResponse.statusCode,
    401,
    'Old rotated refresh token should be rejected',
  )
})

test('POST /auth/refresh 401 - Rejects access tokens supplied via the refreshToken cookie', async (t) => {
  // Arrange
  const { app, accessToken } = await setup(t, 'user')
  const { csrfToken, csrfCookieHeader } = await issueCsrfContext(app)
  const cookieHeader = buildRefreshTokenCookieHeader(accessToken, csrfCookieHeader)

  // Act
  const response = await app.inject({
    method: 'POST',
    url: '/auth/refresh',
    headers: {
      cookie: cookieHeader,
      'x-csrf-token': csrfToken,
    },
  })

  // Assert
  assert.strictEqual(response.statusCode, 401)
  assertRefreshCookieExpired(response.headers['set-cookie'])
})

test('POST /auth/refresh 401 - Clears stale refresh cookie for missing user', async (t) => {
  // Arrange
  const { app, refreshToken, userId, mongoUrl } = await setup(t, 'user')
  const { csrfToken, csrfCookieHeader } = await issueCsrfContext(app)
  const client = new MongoClient(mongoUrl)
  await client.connect()
  try {
    await client
      .db()
      .collection('users')
      .updateOne({ _id: userId }, { $set: { deleted: true, deletedAt: new Date() } })
  } finally {
    await client.close()
  }
  const cookieHeader = buildRefreshTokenCookieHeader(refreshToken, csrfCookieHeader)

  // Act
  const response = await app.inject({
    method: 'POST',
    url: '/auth/refresh',
    headers: {
      cookie: cookieHeader,
      'x-csrf-token': csrfToken,
    },
  })

  // Assert
  assert.strictEqual(response.statusCode, 401)
  assertRefreshCookieExpired(response.headers['set-cookie'])
})
