'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUIDv7 } = require('node:crypto')
const { generateMalformedUUIDs, randomUsername } = require('../../utils/data-creator')
const { seedUser } = require('../../utils/setup-user')

describe('PUT /users/:id', () => {
  test('returns 204 and updates target user profile fields for admin', async (t) => {
    // Arrange
    const admin = await seedUser(t, { role: 'admin' })
    const target = await seedUser(t, { app: admin.app, role: 'user' })
    const newUsername = randomUsername(16)

    // Act
    const response = await admin.app.inject({
      method: 'PUT',
      url: `/users/${target.userId}`,
      headers: { Authorization: `Bearer ${admin.accessToken}` },
      payload: {
        username: newUsername.toUpperCase(),
        firstName: 'Grace',
      },
    })

    // Assert
    assert.equal(response.statusCode, 204)
    assert.equal(response.body, '')

    const updated = await admin.app.usersDataSource.readUserDetails(target.userId)
    assert.equal(updated.username, newUsername.toLowerCase())
    assert.equal(updated.firstName, 'Grace')
  })

  test('returns 204, updates target user role, and writes user_role_changed audit log', async (t) => {
    // Arrange
    const admin = await seedUser(t, { role: 'admin' })
    const target = await seedUser(t, { app: admin.app, role: 'user' })

    // Act
    const response = await admin.app.inject({
      method: 'PUT',
      url: `/users/${target.userId}`,
      headers: { Authorization: `Bearer ${admin.accessToken}` },
      payload: { role: 'admin' },
    })

    // Assert
    assert.equal(response.statusCode, 204)
    assert.equal(response.body, '')

    const updated = await admin.app.usersDataSource.readUserDetails(target.userId)
    assert.equal(updated.role, 'admin')

    await admin.app.flushAuditLogs()
    const auditLogs = await admin.app.mongo.db
      .collection('auditLogs')
      .find({
        action: 'user_role_changed',
        userId: admin.userId,
        resourceType: 'user',
        resourceId: target.userId,
      })
      .toArray()
    assert.equal(auditLogs.length, 1)
    assert.deepEqual(auditLogs[0].details, {
      previousRole: 'user',
      newRole: 'admin',
      targetUserId: target.userId,
    })
    assert.equal(typeof auditLogs[0].requestId, 'string')
  })

  test('returns 400 when attempting to update forbidden deleted field', async (t) => {
    // Arrange
    const admin = await seedUser(t, { role: 'admin' })
    const target = await seedUser(t, { app: admin.app, role: 'user' })

    // Act
    const response = await admin.app.inject({
      method: 'PUT',
      url: `/users/${target.userId}`,
      headers: { Authorization: `Bearer ${admin.accessToken}` },
      payload: { deleted: true },
    })

    // Assert
    assert.equal(response.statusCode, 400)
    const unchanged = await admin.app.usersDataSource.readUserDetails(target.userId)
    assert.equal(unchanged.role, 'user')
  })

  test('returns 400 when user id param is not a valid UUID', async (t) => {
    // Arrange
    const admin = await seedUser(t, { role: 'admin' })
    const { tooShort } = generateMalformedUUIDs()

    // Act
    const response = await admin.app.inject({
      method: 'PUT',
      url: `/users/${tooShort}`,
      headers: { Authorization: `Bearer ${admin.accessToken}` },
      payload: { firstName: 'Ignored' },
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 401 when unauthenticated', async (t) => {
    // Arrange
    const target = await seedUser(t)

    // Act
    const response = await target.app.inject({
      method: 'PUT',
      url: `/users/${target.userId}`,
      payload: { username: randomUsername(14) },
    })

    // Assert
    assert.equal(response.statusCode, 401)
  })

  test('returns 403 when regular non-admin user updates another user', async (t) => {
    // Arrange
    const regularUser = await seedUser(t, { role: 'user' })
    const target = await seedUser(t, { app: regularUser.app, role: 'user' })

    // Act
    const response = await regularUser.app.inject({
      method: 'PUT',
      url: `/users/${target.userId}`,
      headers: { Authorization: `Bearer ${regularUser.accessToken}` },
      payload: { username: randomUsername(16) },
    })

    // Assert
    assert.equal(response.statusCode, 403)
    const unchanged = await regularUser.app.usersDataSource.readUserDetails(target.userId)
    assert.equal(unchanged.username, target.username)
  })

  test('returns 404 when target user does not exist', async (t) => {
    // Arrange
    const admin = await seedUser(t, { role: 'admin' })

    // Act
    const response = await admin.app.inject({
      method: 'PUT',
      url: `/users/${randomUUIDv7()}`,
      headers: { Authorization: `Bearer ${admin.accessToken}` },
      payload: { username: randomUsername(16) },
    })

    // Assert
    assert.equal(response.statusCode, 404)
  })

  test('returns 409 when updating username to an existing user', async (t) => {
    // Arrange
    const admin = await seedUser(t, { role: 'admin' })
    const target = await seedUser(t, { app: admin.app, role: 'user' })
    const existing = await seedUser(t, { app: admin.app, role: 'user' })

    // Act
    const response = await admin.app.inject({
      method: 'PUT',
      url: `/users/${target.userId}`,
      headers: { Authorization: `Bearer ${admin.accessToken}` },
      payload: { username: existing.username.toUpperCase() },
    })

    // Assert
    assert.equal(response.statusCode, 409)
  })

  test('returns 409 when updating email to an existing user', async (t) => {
    // Arrange
    const admin = await seedUser(t, { role: 'admin' })
    const target = await seedUser(t, { app: admin.app, role: 'user' })
    const existing = await seedUser(t, { app: admin.app, role: 'user' })

    // Act
    const response = await admin.app.inject({
      method: 'PUT',
      url: `/users/${target.userId}`,
      headers: { Authorization: `Bearer ${admin.accessToken}` },
      payload: { email: existing.email.toUpperCase() },
    })

    // Assert
    assert.equal(response.statusCode, 409)
  })
})
