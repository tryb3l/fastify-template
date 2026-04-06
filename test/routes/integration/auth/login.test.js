'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { setup } = require('../../../utils/setup-user')
const { randomUsername, randomPassword } = require('../../../utils/data-creator')

function findRefreshCookie(setCookieHeader) {
  const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader]
  return cookies.find((cookie) => cookie && cookie.startsWith('refreshToken='))
}

test('POST /auth/authenticate 200 - User can successfully login and receive tokens', async (t) => {
  // Arrange
  const { app, username, password, userId } = await setup(t)

  // Act
  const response = await app.inject({
    method: 'POST',
    url: '/auth/authenticate',
    payload: {
      username: username,
      password: password,
    },
  })

  const body = response.json()
  const refreshCookie = findRefreshCookie(response.headers['set-cookie'])

  // Assert
  assert.strictEqual(response.statusCode, 200)
  assert.ok(body.access_token, 'Access token should be returned')
  assert.strictEqual(body.refresh_token, undefined, 'Refresh token should not be in body payload')
  assert.ok(refreshCookie, 'Refresh token cookie should be set')
  assert.ok(refreshCookie.includes('Path=/auth'), 'Refresh token cookie should be bound to /auth path')
  assert.ok(refreshCookie.includes('HttpOnly'), 'Refresh token cookie must be HttpOnly')
  assert.ok(refreshCookie.includes('SameSite=Lax'), 'Refresh token cookie must be SameSite=Lax')

  assert.strictEqual(body.user.username, username)
  assert.strictEqual(body.user.id, userId)
})

test('POST /auth/authenticate 401 - Fails to login with wrong password', async (t) => {
  // Arrange
  const { app, username } = await setup(t)

  // Act
  const response = await app.inject({
    method: 'POST',
    url: '/auth/authenticate',
    payload: {
      username: username,
      password: randomPassword(),
    },
  })

  // Assert
  assert.strictEqual(response.statusCode, 401)
  assert.strictEqual(response.json().message, 'Invalid credentials')
})

test('POST /auth/authenticate 401 - Fails to login with non-existent username', async (t) => {
  // Arrange
  const { app } = await setup(t)

  // Act
  const response = await app.inject({
    method: 'POST',
    url: '/auth/authenticate',
    payload: {
      username: randomUsername(),
      password: randomPassword(),
    },
  })

  // Assert
  assert.strictEqual(response.statusCode, 401)
  assert.strictEqual(response.json().message, 'Invalid credentials')
})

test('POST /auth/authenticate 400 - Fails schema validation on missing password', async (t) => {
  // Arrange
  const { app, username } = await setup(t)

  // Act
  const response = await app.inject({
    method: 'POST',
    url: '/auth/authenticate',
    payload: {
      username: username,
      // Missing password
    },
  })

  // Assert
  assert.strictEqual(response.statusCode, 400)
  assert.ok(response.json().message)
})