'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { setup } = require('../../../utils/setup-user')
const { randomUsername, randomPassword } = require('../../../utils/data-creator')

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

  // Assert
  assert.strictEqual(response.statusCode, 200)
  const body = response.json()
  assert.ok(body.access_token, 'Access token should be returned')
  assert.ok(body.refresh_token, 'Refresh token should be returned')
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