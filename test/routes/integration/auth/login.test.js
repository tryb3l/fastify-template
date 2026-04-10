'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { MongoClient } = require('mongodb')
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
  assert.ok(
    refreshCookie.includes('Path=/auth'),
    'Refresh token cookie should be bound to /auth path',
  )
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

test('POST /auth/authenticate 500 - Returns server error when stored password hash is corrupt', async (t) => {
  // Arrange: register a user normally, then corrupt their hash directly in the DB
  const { app, username, mongoUrl } = await setup(t)

  const client = new MongoClient(mongoUrl.replace(/\/test$/, ''))
  await client.connect()
  t.after(() => client.close())

  const adminDb = client.db().admin()
  const { databases } = await adminDb.listDatabases()
  for (const dbInfo of databases) {
    const db = client.db(dbInfo.name)
    await db
      .collection('users')
      .updateOne({ username }, { $set: { hash: 'this-is-not-a-valid-argon2-hash' } })
  }

  // Act
  const response = await app.inject({
    method: 'POST',
    url: '/auth/authenticate',
    payload: {
      username,
      password: randomPassword(),
    },
  })

  // Assert: argon2.verify throws on corrupt hash, route maps it to 500
  assert.strictEqual(response.statusCode, 500)
})
