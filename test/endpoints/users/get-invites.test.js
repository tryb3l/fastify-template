'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { randomEmail } = require('../../utils/data-creator')
const { seedUser } = require('../../utils/setup-user')

describe('GET /users/invites', () => {
  test('returns 200 with created invitations excluding secretHash', async (t) => {
    // Arrange
    const admin = await seedUser(t, { role: 'admin' })
    const invitedEmail = randomEmail(10, 5)
    const createdInvite = await admin.app.usersDataSource.createInvite({
      email: invitedEmail,
      role: 'user',
      ttlHours: 24,
      createdBy: admin.userId,
    })

    // Act
    const response = await admin.app.inject({
      method: 'GET',
      url: '/users/invites',
      headers: { Authorization: `Bearer ${admin.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const list = response.json().data
    assert.ok(Array.isArray(list))
    const found = list.find((inv) => inv.id === createdInvite.id)
    assert.ok(found)
    assert.equal(found.email, invitedEmail.toLowerCase())
    assert.equal(found.role, 'user')
    assert.equal(found.createdBy, admin.userId)
    assert.equal(found.secretHash, undefined)
  })

  test('returns 401 when unauthenticated', async (t) => {
    // Arrange
    const { app } = await seedUser(t)

    // Act
    const response = await app.inject({
      method: 'GET',
      url: '/users/invites',
    })

    // Assert
    assert.equal(response.statusCode, 401)
  })

  test('returns 403 when caller is a regular non-admin user', async (t) => {
    // Arrange
    const regularUser = await seedUser(t, { role: 'user' })

    // Act
    const response = await regularUser.app.inject({
      method: 'GET',
      url: '/users/invites',
      headers: { Authorization: `Bearer ${regularUser.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 403)
  })
})
