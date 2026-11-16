'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { randomPassword, randomUsername } = require('../../utils/data-creator')
const { findRefreshCookie } = require('../../utils/csrf')
const { setup } = require('../../utils/setup-user')

describe('POST /auth/authenticate', () => {
  test('returns 200 with Bearer access token, HttpOnly refresh cookie, and user profile', async (t) => {
    // Arrange
    const { app, username, password, userId } = await setup(t)

    // Act
    const response = await app.inject({
      method: 'POST',
      url: '/auth/authenticate',
      payload: {
        username,
        password,
      },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const body = response.json()
    const refreshCookie = findRefreshCookie(response.headers['set-cookie'])

    assert.ok(body.access_token)
    assert.equal(body.token_type, 'Bearer')
    assert.equal(typeof body.expires_in, 'number')
    assert.equal(body.refresh_token, undefined)
    assert.deepEqual(body.user, {
      id: userId,
      username: username.toLowerCase(),
      emailVerified: false,
      role: 'user',
    })
    assert.ok(refreshCookie)
    assert.ok(refreshCookie.includes('Path=/auth'))
    assert.ok(refreshCookie.includes('HttpOnly'))
    assert.ok(refreshCookie.includes('SameSite=Lax'))
  })

  test('returns 200 when authenticating with email identifier', async (t) => {
    // Arrange
    const { app, email, password, userId, username } = await setup(t)

    // Act
    const response = await app.inject({
      method: 'POST',
      url: '/auth/authenticate',
      payload: {
        email: email.toUpperCase(),
        password,
      },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const body = response.json()
    assert.ok(body.access_token)
    assert.equal(body.user.id, userId)
    assert.equal(body.user.username, username.toLowerCase())
  })

  test('returns 400 when password is missing from payload', async (t) => {
    // Arrange
    const { app, username } = await setup(t)

    // Act
    const response = await app.inject({
      method: 'POST',
      url: '/auth/authenticate',
      payload: {
        username,
      },
    })

    // Assert
    assert.equal(response.statusCode, 400)
    assert.ok(response.json().message)
  })

  test('returns 400 when neither username nor email is supplied', async (t) => {
    // Arrange
    const { app, password } = await setup(t)

    // Act
    const response = await app.inject({
      method: 'POST',
      url: '/auth/authenticate',
      payload: {
        password,
      },
    })

    // Assert
    assert.equal(response.statusCode, 400)
    assert.ok(response.json().message)
  })

  test('returns 401 when password does not match stored Argon2id hash', async (t) => {
    // Arrange
    const { app, username } = await setup(t)

    // Act
    const response = await app.inject({
      method: 'POST',
      url: '/auth/authenticate',
      payload: {
        username,
        password: randomPassword(15),
      },
    })

    // Assert
    assert.equal(response.statusCode, 401)
    assert.equal(response.json().message, 'Invalid credentials')
  })

  test('returns 401 when username does not exist', async (t) => {
    // Arrange
    const { app } = await setup(t)

    // Act
    const response = await app.inject({
      method: 'POST',
      url: '/auth/authenticate',
      payload: {
        username: randomUsername(12),
        password: randomPassword(15),
      },
    })

    // Assert
    assert.equal(response.statusCode, 401)
    assert.equal(response.json().message, 'Invalid credentials')
  })
})
