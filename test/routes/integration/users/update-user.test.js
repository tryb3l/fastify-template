'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { setup } = require('../../../utils/setup-user')
const { randomUsername } = require('../../../utils/data-creator')

test('PUT /users/me 200 - Updates self username', async (t) => {
  // Arrange
  const { app, accessToken } = await setup(t, 'user')
  const newUsername = randomUsername(16)

  // Act
  const response = await app.inject({
    method: 'PUT',
    url: `/users/me`,
    headers: { Authorization: `Bearer ${accessToken}` },
    payload: { username: newUsername }
  })

  // Assert
  assert.strictEqual(response.statusCode, 200)
  assert.strictEqual(response.json().data.username, newUsername)
})

test('PUT /users/me 400 - Rejects attacker-controlled identity fields', async (t) => {
  // Arrange
  const actor = await setup(t, 'user')
  const target = await setup(t, 'user')
  const attemptedUsername = randomUsername(16)

  // Act
  const response = await actor.app.inject({
    method: 'PUT',
    url: '/users/me',
    headers: { Authorization: `Bearer ${actor.accessToken}` },
    payload: {
      username: attemptedUsername,
      role: 'admin',
      userId: target.userId,
    }
  })

  // Assert
  assert.strictEqual(response.statusCode, 400)

  const actorVerify = await actor.app.inject({
    method: 'GET',
    url: '/users/me',
    headers: { Authorization: `Bearer ${actor.accessToken}` },
  })
  const targetVerify = await target.app.inject({
    method: 'GET',
    url: '/users/me',
    headers: { Authorization: `Bearer ${target.accessToken}` },
  })

  assert.strictEqual(actorVerify.statusCode, 200)
  assert.strictEqual(actorVerify.json().data.username, actor.username)
  assert.strictEqual(targetVerify.statusCode, 200)
  assert.strictEqual(targetVerify.json().data.username, target.username)
})

test('PUT /users/:id 204 - Admin updates another user', async (t) => {
  // Arrange
  const { app, accessToken: adminToken } = await setup(t, 'admin')
  const targetUser = await setup(t, 'user')
  const newUsername = randomUsername(16)

  // Act
  const response = await app.inject({
    method: 'PUT',
    url: `/users/${targetUser.userId}`,
    headers: { Authorization: `Bearer ${adminToken}` },
    payload: { username: newUsername }
  })

  // Assert
  assert.strictEqual(response.statusCode, 204)
  assert.strictEqual(response.body, '')

  const verifyResponse = await targetUser.app.inject({
    method: 'GET',
    url: '/users/me',
    headers: { Authorization: `Bearer ${targetUser.accessToken}` },
  })

  assert.strictEqual(verifyResponse.statusCode, 200)
  assert.strictEqual(verifyResponse.json().data.username, newUsername)
})

test('PUT /users/:id 403 - Block user from updating other users', async (t) => {
  // Arrange
  const { app, accessToken } = await setup(t, 'user')
  const targetUser = await setup(t, 'user')
  const attemptedUsername = randomUsername(16)

  // Act
  const response = await app.inject({
    method: 'PUT',
    url: `/users/${targetUser.userId}`,
    headers: { Authorization: `Bearer ${accessToken}` },
    payload: { username: attemptedUsername }
  })

  // Assert
  assert.strictEqual(response.statusCode, 403)

  const verifyResponse = await targetUser.app.inject({
    method: 'GET',
    url: '/users/me',
    headers: { Authorization: `Bearer ${targetUser.accessToken}` },
  })

  assert.strictEqual(verifyResponse.statusCode, 200)
  assert.strictEqual(verifyResponse.json().data.username, targetUser.username)
})

