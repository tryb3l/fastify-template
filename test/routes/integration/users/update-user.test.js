'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { MongoClient } = require('mongodb')
const { setup } = require('../../../utils/setup-user')
const { randomUsername } = require('../../../utils/data-creator')

async function readAuditLogs(mongoUrl, filter) {
  const client = new MongoClient(mongoUrl)
  await client.connect()

  try {
    return await client
      .db()
      .collection('auditLogs')
      .find(filter)
      .sort({ createdAt: 1 })
      .toArray()
  } finally {
    await client.close()
  }
}

async function waitForAuditLogs(mongoUrl, filter, minimumCount = 1) {
  const deadline = Date.now() + 1500

  while (Date.now() < deadline) {
    const logs = await readAuditLogs(mongoUrl, filter)
    if (logs.length >= minimumCount) {
      return logs
    }
  }

  return await readAuditLogs(mongoUrl, filter)
}

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

test('PUT /users/me 400 - Rejects role updates', async (t) => {
  // Arrange
  const actor = await setup(t, 'user')

  // Act
  const response = await actor.app.inject({
    method: 'PUT',
    url: '/users/me',
    headers: { Authorization: `Bearer ${actor.accessToken}` },
    payload: {
      role: 'admin',
    }
  })

  // Assert
  assert.strictEqual(response.statusCode, 400)

  const verifyResponse = await actor.app.inject({
    method: 'GET',
    url: '/users/me',
    headers: { Authorization: `Bearer ${actor.accessToken}` },
  })

  assert.strictEqual(verifyResponse.statusCode, 200)
  assert.strictEqual(verifyResponse.json().data.role, 'user')
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

test('PUT /users/:id 204 - Admin updates another user role', async (t) => {
  // Arrange
  const { app, accessToken: adminToken } = await setup(t, 'admin')
  const targetUser = await setup(t, 'user')

  // Act
  const response = await app.inject({
    method: 'PUT',
    url: `/users/${targetUser.userId}`,
    headers: { Authorization: `Bearer ${adminToken}` },
    payload: { role: 'admin' }
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
  assert.strictEqual(verifyResponse.json().data.role, 'admin')
})

test('PUT /users/:id 204 - Admin role change writes an audit log', async (t) => {
  // Arrange
  const { app, accessToken: adminToken, userId: adminUserId, mongoUrl } = await setup(t, 'admin')
  const targetUser = await setup(t, 'user')

  // Act
  const response = await app.inject({
    method: 'PUT',
    url: `/users/${targetUser.userId}`,
    headers: { Authorization: `Bearer ${adminToken}` },
    payload: { role: 'admin' }
  })

  // Assert
  assert.strictEqual(response.statusCode, 204)

  const auditLogs = await waitForAuditLogs(mongoUrl, {
    action: 'user_role_changed',
    userId: adminUserId,
    resourceType: 'user',
    resourceId: targetUser.userId,
  })

  assert.strictEqual(auditLogs.length, 1)
  assert.strictEqual(auditLogs[0].userId, adminUserId)
  assert.strictEqual(auditLogs[0].resourceType, 'user')
  assert.strictEqual(auditLogs[0].resourceId, targetUser.userId)
  assert.deepStrictEqual(auditLogs[0].details, {
    previousRole: 'user',
    newRole: 'admin',
    targetUserId: targetUser.userId,
  })
  assert.strictEqual(typeof auditLogs[0].requestId, 'string')
})

test('PUT /users/:id 400 - Admin cannot update deleted field', async (t) => {
  // Arrange
  const { app, accessToken: adminToken } = await setup(t, 'admin')
  const targetUser = await setup(t, 'user')

  // Act
  const response = await app.inject({
    method: 'PUT',
    url: `/users/${targetUser.userId}`,
    headers: { Authorization: `Bearer ${adminToken}` },
    payload: { deleted: true }
  })

  // Assert
  assert.strictEqual(response.statusCode, 400)

  const verifyResponse = await targetUser.app.inject({
    method: 'GET',
    url: '/users/me',
    headers: { Authorization: `Bearer ${targetUser.accessToken}` },
  })

  assert.strictEqual(verifyResponse.statusCode, 200)
  assert.strictEqual(verifyResponse.json().data.role, 'user')
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

