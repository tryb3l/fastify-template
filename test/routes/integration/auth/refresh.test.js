'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { setup } = require('../../../utils/setup-user')

test('POST /auth/refresh 200 - Successfully rotates tokens with valid CSRF', async (t) => {
  // Arrange
  const { app, refreshToken } = await setup(t, 'user')

  // Get CSRF Token
  const csrfResponse = await app.inject({
    method: 'GET',
    url: '/auth/csrf'
  })
  const csrfToken = csrfResponse.json().csrfToken
  const csrfCookie = csrfResponse.headers['set-cookie']

  // Act
  const refreshResponse = await app.inject({
    method: 'POST',
    url: '/auth/refresh',
    headers: {
      cookie: `refreshToken=${refreshToken}; ${Array.isArray(csrfCookie) ? csrfCookie[0] : csrfCookie}`,
      'x-csrf-token': csrfToken
    }
  })

  // Assert
  assert.strictEqual(refreshResponse.statusCode, 200)
  const body = refreshResponse.json()
  assert.ok(body.access_token, 'New Access Token should be returned')
  assert.strictEqual(body.token_type, 'Bearer')

  const setCookie = refreshResponse.headers['set-cookie']
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie]
  const newRefreshCookie = cookies.find(c => c && c.startsWith('refreshToken='))

  assert.ok(newRefreshCookie, 'New Refresh token cookie should be set')
  const newRefreshToken = newRefreshCookie.split(';')[0].split('=')[1]
  assert.notStrictEqual(newRefreshToken, refreshToken, 'Refresh token should rotate')

  // Act (Second Refresh with old token should fail)
  const oldRefreshResponse = await app.inject({
    method: 'POST',
    url: '/auth/refresh',
    headers: {
      cookie: `refreshToken=${refreshToken}; ${Array.isArray(csrfCookie) ? csrfCookie[0] : csrfCookie}`,
      'x-csrf-token': csrfToken
    }
  })

  // Assert
  assert.strictEqual(oldRefreshResponse.statusCode, 401, 'Old rotated refresh token should be rejected')
})
