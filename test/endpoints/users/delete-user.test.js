'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUIDv7 } = require('node:crypto')
const { generateMalformedUUIDs } = require('../../utils/data-creator')
const { seedUser } = require('../../utils/setup-user')

describe('DELETE /users/:id', () => {
  test('returns 204, deletes target user, and writes user_soft_deleted audit log for admin', async (t) => {
    // Arrange
    const admin = await seedUser(t, { role: 'admin' })
    const target = await seedUser(t, { app: admin.app, role: 'user' })

    // Act
    const response = await admin.app.inject({
      method: 'DELETE',
      url: `/users/${target.userId}`,
      headers: { Authorization: `Bearer ${admin.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 204)
    assert.equal(response.body, '')
    assert.equal(await admin.app.usersDataSource.readUserDetails(target.userId), null)

    await admin.app.flushAuditLogs()
    const auditLogs = await admin.app.mongo.db
      .collection('auditLogs')
      .find({
        action: 'user_soft_deleted',
        userId: admin.userId,
        resourceType: 'user',
        resourceId: target.userId,
      })
      .toArray()
    assert.equal(auditLogs.length, 1)
    assert.equal(typeof auditLogs[0].requestId, 'string')
  })

  test('returns 400 when user id is not a valid UUID', async (t) => {
    // Arrange
    const admin = await seedUser(t, { role: 'admin' })
    const { tooShort } = generateMalformedUUIDs()

    // Act
    const response = await admin.app.inject({
      method: 'DELETE',
      url: `/users/${tooShort}`,
      headers: { Authorization: `Bearer ${admin.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 401 when unauthenticated', async (t) => {
    // Arrange
    const target = await seedUser(t)

    // Act
    const response = await target.app.inject({
      method: 'DELETE',
      url: `/users/${target.userId}`,
    })

    // Assert
    assert.equal(response.statusCode, 401)
  })

  test('returns 403 when caller is a regular non-admin user', async (t) => {
    // Arrange
    const regularUser = await seedUser(t, { role: 'user' })
    const target = await seedUser(t, { app: regularUser.app, role: 'user' })

    // Act
    const response = await regularUser.app.inject({
      method: 'DELETE',
      url: `/users/${target.userId}`,
      headers: { Authorization: `Bearer ${regularUser.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 403)
    assert.ok(await regularUser.app.usersDataSource.readUserDetails(target.userId))
  })

  test('returns 404 when target user does not exist', async (t) => {
    // Arrange
    const admin = await seedUser(t, { role: 'admin' })

    // Act
    const response = await admin.app.inject({
      method: 'DELETE',
      url: `/users/${randomUUIDv7()}`,
      headers: { Authorization: `Bearer ${admin.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 404)
  })
})
