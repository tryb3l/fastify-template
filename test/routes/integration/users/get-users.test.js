'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { setup } = require('../../../utils/setup-user')
const { randomUsername } = require('../../../utils/data-creator')

test('GET /users - Admin user can list users', async (t) => {
  // Arrange
  const { app, accessToken } = await setup(t, 'admin')

  // Act
  const response = await app.inject({
    method: 'GET',
    url: '/users',
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  assert.strictEqual(response.statusCode, 200)
  const body = response.json()
  assert.ok(Array.isArray(body.data))
  assert.ok(typeof body.totalCount === 'number')
})

test('GET /users - Regular user receives 403 Forbidden', async (t) => {
  // Arrange
  const { app, accessToken } = await setup(t, 'user')

  // Act
  const response = await app.inject({
    method: 'GET',
    url: '/users',
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  assert.strictEqual(response.statusCode, 403)
})

test('GET /users - Unauthenticated user receives 401 Unauthorized', async (t) => {
  // Arrange
  const { app } = await setup(t, 'user')

  // Act
  const response = await app.inject({
    method: 'GET',
    url: '/users',
  })

  // Assert
  assert.strictEqual(response.statusCode, 401)
})

test('GET /users - Admin can filter users by username', async (t) => {
  // Arrange
  const { app, accessToken, username } = await setup(t, 'admin')
  const searchUsername = username || randomUsername()

  // Act
  const response = await app.inject({
    method: 'GET',
    url: `/users?username=${searchUsername}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  assert.strictEqual(response.statusCode, 200)
  const body = response.json()
  assert.ok(Array.isArray(body.data))
  // Verify that if any users are returned, their username matches
  if (body.data.length > 0) {
    assert.strictEqual(body.data[0].username, searchUsername)
  }
})

test('GET /users - Admin can paginate users with limit and skip', async (t) => {
  // Arrange
  const { app, accessToken } = await setup(t, 'admin')
  const limit = 1
  const skip = 0

  // Act
  const response = await app.inject({
    method: 'GET',
    url: `/users?limit=${limit}&skip=${skip}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  assert.strictEqual(response.statusCode, 200)
  const body = response.json()
  assert.ok(Array.isArray(body.data))
  assert.ok(body.data.length <= limit)
})