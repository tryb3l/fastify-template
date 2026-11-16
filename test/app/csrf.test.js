'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { seedUser } = require('../utils/setup-user')
const { buildRefreshTokenCookieHeader, getCookiePair, issueCsrfContext } = require('../utils/csrf')

describe('CSRF protection policy', () => {
  test('issues a CSRF token and _csrf cookie on GET /auth/csrf', async (t) => {
    // Arrange
    const { app } = await seedUser(t)

    // Act
    const response = await app.inject({
      method: 'GET',
      url: '/auth/csrf',
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.ok(response.json().csrfToken)
    assert.ok(getCookiePair(response.headers['set-cookie']))
  })

  test('rejects POST /auth/refresh with 403 when CSRF token is missing', async (t) => {
    // Arrange
    const { app, refreshToken } = await seedUser(t)
    const cookieHeader = `refreshToken=${refreshToken}`

    // Act
    const response = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: { cookie: cookieHeader },
    })

    // Assert
    assert.equal(response.statusCode, 403)
  })

  test('rejects POST /auth/logout with 403 when CSRF token is missing', async (t) => {
    // Arrange
    const { app, refreshToken } = await seedUser(t)
    const cookieHeader = `refreshToken=${refreshToken}`

    // Act
    const response = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { cookie: cookieHeader },
    })

    // Assert
    assert.equal(response.statusCode, 403)
  })

  test('rejects POST /auth/refresh with 403 when CSRF token is invalid', async (t) => {
    // Arrange
    const { app, refreshToken } = await seedUser(t)
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
    assert.equal(response.statusCode, 403)
  })

  test('rejects POST /auth/logout with 403 when CSRF token is invalid', async (t) => {
    // Arrange
    const { app, refreshToken } = await seedUser(t)
    const { csrfCookieHeader } = await issueCsrfContext(app)
    const cookieHeader = buildRefreshTokenCookieHeader(refreshToken, csrfCookieHeader)

    // Act
    const response = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: {
        cookie: cookieHeader,
        'x-csrf-token': 'invalid-token-signature-attempt',
      },
    })

    // Assert
    assert.equal(response.statusCode, 403)
  })
})
