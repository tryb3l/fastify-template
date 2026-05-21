'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { MongoClient } = require('mongodb')
const { setup } = require('../../../utils/setup-user')
const { flushAuditLogs } = require('../../../utils/audit')

async function readAuditLogs(mongoUrl, filter) {
  const client = new MongoClient(mongoUrl)
  await client.connect()

  try {
    return await client.db().collection('auditLogs').find(filter).sort({ createdAt: 1 }).toArray()
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

    await new Promise((resolve) => setTimeout(resolve, 25))
  }

  return await readAuditLogs(mongoUrl, filter)
}

async function deleteCurrentUser(app, accessToken) {
  return await app.inject({
    method: 'DELETE',
    url: '/users/me',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
}

test('DELETE /users/me 204 - Deletes self', async (t) => {
  // Arrange
  const { app, accessToken } = await setup(t, 'user')

  // Act
  const response = await deleteCurrentUser(app, accessToken)

  // Assert
  assert.strictEqual(response.statusCode, 204)
})

test('DELETE /users/me 204 - Deletes only the authenticated user', async (t) => {
  // Arrange
  const actor = await setup(t, 'user')
  const bystander = await setup(t, 'user')

  // Act
  const response = await deleteCurrentUser(actor.app, actor.accessToken)

  // Assert
  assert.strictEqual(response.statusCode, 204)

  const bystanderVerify = await bystander.app.inject({
    method: 'GET',
    url: '/users/me',
    headers: { Authorization: `Bearer ${bystander.accessToken}` },
  })

  assert.strictEqual(bystanderVerify.statusCode, 200)
  assert.strictEqual(bystanderVerify.json().data.username, bystander.username)
})

test('DELETE /users/me 204 - Writes an audit log for self delete', async (t) => {
  // Arrange
  const { app, accessToken, userId, mongoUrl } = await setup(t, 'user')

  // Act
  const response = await deleteCurrentUser(app, accessToken)

  // Assert
  assert.strictEqual(response.statusCode, 204)
  await flushAuditLogs()

  const auditLogs = await waitForAuditLogs(mongoUrl, {
    action: 'user_soft_deleted',
    userId,
    resourceType: 'user',
    resourceId: userId,
  })

  assert.strictEqual(auditLogs.length, 1)
  assert.strictEqual(auditLogs[0].userId, userId)
  assert.strictEqual(auditLogs[0].resourceId, userId)
  assert.strictEqual(auditLogs[0].resourceType, 'user')
  assert.strictEqual(typeof auditLogs[0].requestId, 'string')
})

test('GET /users/me 401 - Rejects the stale token after self delete', async (t) => {
  // Arrange
  const { app, accessToken } = await setup(t, 'user')
  const deleteResponse = await deleteCurrentUser(app, accessToken)
  assert.strictEqual(deleteResponse.statusCode, 204)

  // Act
  const meVerify = await app.inject({
    method: 'GET',
    url: '/users/me',
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  assert.strictEqual(meVerify.statusCode, 401)
})

test('DELETE /users/:id 204 - Admin deletes other users', async (t) => {
  // Arrange
  const { app, accessToken: adminToken } = await setup(t, 'admin')
  const { userId } = await setup(t, 'user')

  // Act
  const response = await app.inject({
    method: 'DELETE',
    url: `/users/${userId}`,
    headers: { Authorization: `Bearer ${adminToken}` },
  })

  // Assert
  assert.strictEqual(response.statusCode, 204)
})
