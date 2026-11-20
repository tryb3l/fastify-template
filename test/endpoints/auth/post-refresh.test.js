'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { setup } = require('../../utils/setup-user')
const {
  assertRefreshCookieExpired,
  buildRefreshTokenCookieHeader,
  findRefreshCookie,
  issueCsrfContext,
} = require('../../utils/csrf')

describe('POST /auth/refresh', () => {
  test('returns 200 and rotates refresh token with valid CSRF context', async (t) => {
    // Arrange
    const { app, refreshToken } = await setup(t, 'user')
    const { csrfToken, csrfCookieHeader } = await issueCsrfContext(app)
    const originalRefreshCookieHeader = buildRefreshTokenCookieHeader(
      refreshToken,
      csrfCookieHeader,
    )

    // Act
    const response = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: {
        cookie: originalRefreshCookieHeader,
        'x-csrf-token': csrfToken,
      },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const body = response.json()
    const newRefreshCookie = findRefreshCookie(response.headers['set-cookie'])

    assert.ok(body.access_token)
    assert.equal(body.token_type, 'Bearer')
    assert.ok(newRefreshCookie)
    const newRefreshToken = newRefreshCookie.split(';')[0].split('=')[1]
    assert.notEqual(newRefreshToken, refreshToken)
  })

  test('returns 401, clears cookie, increments credentialsVersion, and writes audit event when presenting an already-rotated refresh token', async (t) => {
    // Arrange
    const { app, refreshToken, userId } = await setup(t, 'user')
    const { csrfToken, csrfCookieHeader } = await issueCsrfContext(app)
    const originalRefreshCookieHeader = buildRefreshTokenCookieHeader(
      refreshToken,
      csrfCookieHeader,
    )
    const rotateResponse = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: {
        cookie: originalRefreshCookieHeader,
        'x-csrf-token': csrfToken,
      },
    })
    assert.equal(rotateResponse.statusCode, 200)

    // Act
    const response = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: {
        cookie: originalRefreshCookieHeader,
        'x-csrf-token': csrfToken,
      },
    })

    // Assert
    assert.equal(response.statusCode, 401)
    assertRefreshCookieExpired(response.headers['set-cookie'])

    const user = await app.usersDataSource.readUserById(userId)
    assert.equal(user.credentialsVersion, 1)

    await app.flushAuditLogs()
    const logs = await app.mongo.db.collection('auditLogs').find({ userId }).toArray()
    const reuseLog = logs.find(log => log.action === 'auth_refresh_token_reused')
    assert.ok(reuseLog, 'Expected auth_refresh_token_reused audit log')
    assert.equal(reuseLog.resourceType, 'user')
    assert.equal(reuseLog.resourceId, userId)
    assert.equal(reuseLog.details.severity, 'high')
  })

  test('concurrent refresh token rotation requests succeed for one and fail for others with lockout', async (t) => {
    // Arrange
    const { app, refreshToken, userId } = await setup(t, 'user')
    
    // Act
    const requests = Array.from({ length: 3 }).map(async () => {
      const { csrfToken, csrfCookieHeader } = await issueCsrfContext(app)
      const originalRefreshCookieHeader = buildRefreshTokenCookieHeader(
        refreshToken,
        csrfCookieHeader,
      )
      return app.inject({
        method: 'POST',
        url: '/auth/refresh',
        headers: {
          cookie: originalRefreshCookieHeader,
          'x-csrf-token': csrfToken,
        },
      })
    })

    const responses = await Promise.all(requests)

    // Assert
    const successes = responses.filter(r => r.statusCode === 200)
    const failures = responses.filter(r => r.statusCode === 401)
    
    assert.equal(successes.length, 1)
    assert.equal(failures.length, 2)
    
    const user = await app.usersDataSource.readUserById(userId)
    assert.equal(user.credentialsVersion, 2) // Bumped twice for the two failures
    
    await app.flushAuditLogs()
    const logs = await app.mongo.db.collection('auditLogs').find({ userId, action: 'auth_refresh_token_reused' }).toArray()
    assert.equal(logs.length, 2) // One for each failed attempt
  })

  test('returns 401 and clears cookie when refreshToken cookie is missing', async (t) => {
    // Arrange
    const { app } = await setup(t, 'user')
    const { csrfToken, csrfCookieHeader } = await issueCsrfContext(app)

    // Act
    const response = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: {
        cookie: csrfCookieHeader,
        'x-csrf-token': csrfToken,
      },
    })

    // Assert
    assert.equal(response.statusCode, 401)
    assertRefreshCookieExpired(response.headers['set-cookie'])
  })

  test('returns 401 and clears cookie when access token is supplied in refreshToken cookie', async (t) => {
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
    assert.equal(response.statusCode, 401)
    assertRefreshCookieExpired(response.headers['set-cookie'])
  })

  test('returns 401 and clears stale cookie for deleted user', async (t) => {
    // Arrange
    const { app, refreshToken, userId } = await setup(t, 'user')
    const { csrfToken, csrfCookieHeader } = await issueCsrfContext(app)
    await app.usersDataSource.deleteUser(userId)
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
    assert.equal(response.statusCode, 401)
    assertRefreshCookieExpired(response.headers['set-cookie'])
  })

  test('returns 403 when CSRF header is missing even if refreshToken is also missing', async (t) => {
    // Arrange
    const { app } = await setup(t, 'user')

    // Act
    const response = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: {
        // No cookies, no CSRF
      },
    })

    // Assert
    assert.equal(response.statusCode, 403)
  })
})
