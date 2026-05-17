'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { setup } = require('../../../utils/setup-user')
const { randomUUIDv7 } = require('node:crypto')
const { generateMalformedUUIDs } = require('../../../utils/data-creator')

test('GET /users/:id 200 - Admin can fetch user details', async (t) => {
  // Arrange
  const { app, accessToken, userId, username } = await setup(t, 'admin')

  // Act
  const response = await app.inject({
    method: 'GET',
    url: `/users/${userId}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  assert.strictEqual(response.statusCode, 200)
  assert.strictEqual(response.json().data.username, username)
})

test('GET /users/:id 404 - User not found', async (t) => {
  // Arrange
  const { app, accessToken } = await setup(t, 'admin')
  const nonExistentUserId = randomUUIDv7()

  // Act
  const response = await app.inject({
    method: 'GET',
    url: `/users/${nonExistentUserId}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  assert.strictEqual(response.statusCode, 404)
})

test('GET /users/:id 400 - Invalid ID format', async (t) => {
  // Arrange
  const { app, accessToken } = await setup(t, 'admin')
  const { tooShort } = generateMalformedUUIDs()

  // Act
  const response = await app.inject({
    method: 'GET',
    url: `/users/${tooShort}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  assert.strictEqual(response.statusCode, 400)
})

test('GET /users/:id 403 - Regular user receives 403 Forbidden', async (t) => {
  // Arrange
  const { app, accessToken, userId } = await setup(t, 'user')

  // Act
  const response = await app.inject({
    method: 'GET',
    url: `/users/${userId}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  assert.strictEqual(response.statusCode, 403)
})

test('GET /users/:id 401 - Unauthenticated user receives 401 Unauthorized', async (t) => {
  // Arrange
  const { app, userId } = await setup(t, 'user')

  // Act
  const response = await app.inject({
    method: 'GET',
    url: `/users/${userId}`,
  })

  // Assert
  assert.strictEqual(response.statusCode, 401)
})
