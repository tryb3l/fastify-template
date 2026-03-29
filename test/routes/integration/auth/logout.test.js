'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { setup } = require('../../../utils/setup-user')

test('POST /auth/logout 204 - Successfully clears token session', async (t) => {
  // Arrange
  const { app, refreshToken } = await setup(t, 'user')

  const csrfResponse = await app.inject({
    method: 'GET',
    url: '/auth/csrf'
  })
  const csrfToken = csrfResponse.json().csrfToken
  const csrfCookie = csrfResponse.headers['set-cookie']
  const cookieHeader = `refreshToken=${refreshToken}; ${Array.isArray(csrfCookie) ? csrfCookie[0] : csrfCookie}`

  // Act (Logout)
  const logoutResponse = await app.inject({
    method: 'POST',
    url: '/auth/logout',
    headers: {
      cookie: cookieHeader,
      'x-csrf-token': csrfToken
    }
  })

  // Assert
  assert.strictEqual(logoutResponse.statusCode, 204)
  const setCookie = logoutResponse.headers['set-cookie']
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie]

  const clearCookie = cookies.find(c => c && c.startsWith('refreshToken='))
  assert.ok(clearCookie, 'Refresh token cookie directive should be present')
  assert.ok(clearCookie.includes('Max-Age=0') || clearCookie.includes('Expires='), 'Cookie should be explicitly expired')
  assert.ok(clearCookie.includes('Path=/auth'), 'Clear cookie should match /auth path')

  // Act (Try to refresh with destroyed token)
  const refreshResponse = await app.inject({
    method: 'POST',
    url: '/auth/refresh',
    headers: {
      cookie: cookieHeader,
      'x-csrf-token': csrfToken
    }
  })

  // Assert
  assert.strictEqual(refreshResponse.statusCode, 401, 'Logged out tokens must be rejected natively by the cache/rotation store')
})
