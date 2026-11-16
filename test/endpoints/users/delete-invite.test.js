'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUIDv7 } = require('node:crypto')
const { generateMalformedUUIDs } = require('../../utils/data-creator')
const { seedUser } = require('../../utils/setup-user')

describe('DELETE /users/invites/:id', () => {
  test('returns 204 and revokes existing invitation', async (t) => {
    // Arrange
    const admin = await seedUser(t, { role: 'admin' })
    const invite = await admin.app.usersDataSource.createInvite({
      role: 'user',
      ttlHours: 24,
      createdBy: admin.userId,
    })

    // Act
    const response = await admin.app.inject({
      method: 'DELETE',
      url: `/users/invites/${invite.id}`,
      headers: { Authorization: `Bearer ${admin.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 204)
    assert.equal(response.body, '')
    const remaining = await admin.app.usersDataSource.listInvites()
    assert.equal(
      remaining.some((item) => item.id === invite.id),
      false,
    )
  })

  test('returns 400 when invitation id is not a valid UUID', async (t) => {
    // Arrange
    const admin = await seedUser(t, { role: 'admin' })
    const { tooShort } = generateMalformedUUIDs()

    // Act
    const response = await admin.app.inject({
      method: 'DELETE',
      url: `/users/invites/${tooShort}`,
      headers: { Authorization: `Bearer ${admin.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 401 when unauthenticated', async (t) => {
    // Arrange
    const { app } = await seedUser(t)

    // Act
    const response = await app.inject({
      method: 'DELETE',
      url: `/users/invites/${randomUUIDv7()}`,
    })

    // Assert
    assert.equal(response.statusCode, 401)
  })

  test('returns 403 when caller is a regular non-admin user', async (t) => {
    // Arrange
    const regularUser = await seedUser(t, { role: 'user' })
    const admin = await seedUser(t, { app: regularUser.app, role: 'admin' })
    const invite = await admin.app.usersDataSource.createInvite({
      role: 'user',
      ttlHours: 24,
      createdBy: admin.userId,
    })

    // Act
    const response = await regularUser.app.inject({
      method: 'DELETE',
      url: `/users/invites/${invite.id}`,
      headers: { Authorization: `Bearer ${regularUser.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 403)
  })

  test('returns 404 when invitation does not exist', async (t) => {
    // Arrange
    const admin = await seedUser(t, { role: 'admin' })

    // Act
    const response = await admin.app.inject({
      method: 'DELETE',
      url: `/users/invites/${randomUUIDv7()}`,
      headers: { Authorization: `Bearer ${admin.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 404)
  })
})
