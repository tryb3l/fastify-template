'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { setup } = require('../../../utils/setup-user')

function findRefreshCookie(setCookieHeader) {
  const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader]
  return cookies.find((cookie) => cookie && cookie.startsWith('refreshToken='))
}

async function issueCsrfContext(app) {
  const csrfResponse = await app.inject({
    method: 'GET',
    url: '/auth/csrf'
  })

  assert.strictEqual(csrfResponse.statusCode, 200)

  return {
    csrfToken: csrfResponse.json().csrfToken,
    csrfCookieHeader: Array.isArray(csrfResponse.headers['set-cookie'])
      ? csrfResponse.headers['set-cookie'][0]
      : csrfResponse.headers['set-cookie']
  }
}

test('POST /auth/refresh 200 - Successfully rotates tokens with valid CSRF', async (t) => {
  // Arrange
  const { app, refreshToken } = await setup(t, 'user')
  const { csrfToken, csrfCookieHeader } = await issueCsrfContext(app)
  const originalRefreshCookieHeader = `refreshToken=${refreshToken}; ${csrfCookieHeader}`

  // Act
  const refreshResponse = await app.inject({
    method: 'POST',
    url: '/auth/refresh',
    headers: {
      cookie: originalRefreshCookieHeader,
      'x-csrf-token': csrfToken
    }
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
      'x-csrf-token': csrfToken
    }
  })

  // Assert
  assert.strictEqual(oldRefreshResponse.statusCode, 401, 'Old rotated refresh token should be rejected')
})
