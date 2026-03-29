'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { setup } = require('../../../utils/setup-user')

test('Auth CSRF Assurances - Enforces Strict Token Presence', async (t) => {
  // Arrange
  const { app, refreshToken } = await setup(t, 'user')
  const cookieHeader = `refreshToken=${refreshToken}`

  // Act (No CSRF on refresh)
  const missingCsrfRefresh = await app.inject({
    method: 'POST',
    url: '/auth/refresh',
    headers: { cookie: cookieHeader }
  })
  assert.strictEqual(missingCsrfRefresh.statusCode, 403, 'Refresh without CSRF token must fail natively')

  // Act (No CSRF on logout)
  const missingCsrfLogout = await app.inject({
    method: 'POST',
    url: '/auth/logout',
    headers: { cookie: cookieHeader }
  })
  assert.strictEqual(missingCsrfLogout.statusCode, 403, 'Logout without CSRF token must fail natively')

  // Act (GET CSRF generation)
  const csrfResponse = await app.inject({
    method: 'GET',
    url: '/auth/csrf'
  })
  assert.strictEqual(csrfResponse.statusCode, 200)
  const csrfToken = csrfResponse.json().csrfToken
  assert.ok(csrfToken, 'Should successfully issue a CSRF generation payload')

  // Act (Invalid CSRF signature on refresh)
  const invalidCsrfRefresh = await app.inject({
    method: 'POST',
    url: '/auth/refresh',
    headers: {
      cookie: cookieHeader,
      'x-csrf-token': 'invalid-token-signature-attempt'
    }
  })
  assert.strictEqual(invalidCsrfRefresh.statusCode, 403, 'Refresh with invalid CSRF token must fail natively')
})
