'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { buildRefreshTokenCookieHeader, issueCsrfContext } = require('../utils/csrf')
const { seedUser, setup } = require('../utils/setup-user')

describe('Authentication token policy', () => {
  test('accepts access tokens supplied via Authorization Bearer header', async (t) => {
    // Arrange
    const { app, accessToken } = await seedUser(t)

    // Act
    const response = await app.inject({
      method: 'GET',
      url: '/users/me',
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
  })

  test('rejects access tokens supplied via cookies with 401', async (t) => {
    // Arrange
    const { app, accessToken } = await seedUser(t)

    // Act
    const response = await app.inject({
      method: 'GET',
      url: '/users/me',
      headers: { cookie: `accessToken=${accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 401)
  })

  test('rejects refresh tokens supplied as Bearer credentials with 401', async (t) => {
    // Arrange
    const { app, refreshToken } = await seedUser(t)

    // Act
    const response = await app.inject({
      method: 'GET',
      url: '/users/me',
      headers: { Authorization: `Bearer ${refreshToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 401)
  })

  test('invalidates access tokens when user credentialsVersion increments', async (t) => {
    // Arrange
    const { app, accessToken, userId } = await seedUser(t)
    await app.usersDataSource.updateUser(userId, { email: `rotated-${userId}@example.com` })

    // Act
    const response = await app.inject({
      method: 'GET',
      url: '/users/me',
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 401)
  })

  test('rejects soft-deleted user sessions across login and token refresh', async (t) => {
    // Arrange: full HTTP setup so user has real Argon2 login credentials before deletion
    const userContext = await setup(t, 'user')
    const adminContext = await seedUser(t, { app: userContext.app, role: 'admin' })

    const deleteRes = await userContext.app.inject({
      method: 'DELETE',
      url: `/users/${userContext.userId}`,
      headers: { Authorization: `Bearer ${adminContext.accessToken}` },
    })
    assert.equal(deleteRes.statusCode, 204)

    const { csrfToken, csrfCookieHeader } = await issueCsrfContext(userContext.app)
    const refreshCookie = buildRefreshTokenCookieHeader(userContext.refreshToken, csrfCookieHeader)

    // Act
    const loginRes = await userContext.app.inject({
      method: 'POST',
      url: '/auth/authenticate',
      payload: { username: userContext.username, password: userContext.password },
    })
    const refreshRes = await userContext.app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: {
        cookie: refreshCookie,
        'x-csrf-token': csrfToken,
      },
    })

    // Assert
    assert.equal(loginRes.statusCode, 401)
    assert.equal(refreshRes.statusCode, 401)
  })
})
