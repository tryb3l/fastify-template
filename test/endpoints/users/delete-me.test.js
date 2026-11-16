'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { seedUser } = require('../../utils/setup-user')

describe('DELETE /users/me', () => {
  test('returns 204, deletes only the authenticated user, and writes user_soft_deleted audit log', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const bystander = await seedUser(t, { app: actor.app })

    // Act
    const response = await actor.app.inject({
      method: 'DELETE',
      url: '/users/me',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 204)
    assert.equal(response.body, '')

    const staleMeRes = await actor.app.inject({
      method: 'GET',
      url: '/users/me',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })
    assert.equal(staleMeRes.statusCode, 401)

    const bystanderRecord = await actor.app.usersDataSource.readUserDetails(bystander.userId)
    assert.ok(bystanderRecord)
    assert.equal(bystanderRecord.username, bystander.username)

    await actor.app.flushAuditLogs()
    const auditLogs = await actor.app.mongo.db
      .collection('auditLogs')
      .find({
        action: 'user_soft_deleted',
        userId: actor.userId,
        resourceType: 'user',
        resourceId: actor.userId,
      })
      .toArray()
    assert.equal(auditLogs.length, 1)
    assert.equal(typeof auditLogs[0].requestId, 'string')
  })

  test('returns 401 when unauthenticated', async (t) => {
    // Arrange
    const { app } = await seedUser(t)

    // Act
    const response = await app.inject({
      method: 'DELETE',
      url: '/users/me',
    })

    // Assert
    assert.equal(response.statusCode, 401)
  })
})
