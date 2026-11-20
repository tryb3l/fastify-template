'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { setup } = require('../../utils/setup-user')
const {
  assertRefreshCookieExpired,
  buildRefreshTokenCookieHeader,
  issueCsrfContext,
} = require('../../utils/csrf')

describe('POST /auth/logout', () => {
  test('returns 204, clears refresh cookie, and revokes refresh token session', async (t) => {
    // Arrange
    const { app, refreshToken } = await setup(t, 'user')
    const { csrfToken, csrfCookieHeader } = await issueCsrfContext(app)
    const cookieHeader = buildRefreshTokenCookieHeader(refreshToken, csrfCookieHeader)

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
    assert.equal(response.statusCode, 204)
    assertRefreshCookieExpired(response.headers['set-cookie'])

    const refreshResponse = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: {
        cookie: cookieHeader,
        'x-csrf-token': csrfToken,
      },
    })
    assert.equal(refreshResponse.statusCode, 401)
  })

  test('returns 401 when refreshToken cookie is missing', async (t) => {
    // Arrange
    const { app } = await setup(t, 'user')
    const { csrfToken, csrfCookieHeader } = await issueCsrfContext(app)

    // Act
    const response = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: {
        cookie: csrfCookieHeader,
        'x-csrf-token': csrfToken,
      },
    })

    // Assert
    assert.equal(response.statusCode, 401)
  })

  test('returns 401 when access token is supplied in refreshToken cookie', async (t) => {
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
    assert.equal(response.statusCode, 401)
  })

  test('returns 403 when CSRF header is missing even if refreshToken is also missing', async (t) => {
    // Arrange
    const { app } = await setup(t, 'user')

    // Act
    const response = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: {
        // No cookies, no CSRF
      },
    })

    // Assert
    assert.equal(response.statusCode, 403)
  })
})
