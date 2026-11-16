'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { randomEmail } = require('../../utils/data-creator')
const { seedUser } = require('../../utils/setup-user')
const mailerPlugin = require('../../../plugins/mailer')

describe('POST /users/invites', () => {
  test('returns 201 and creates an open invitation without sending mail when email is omitted', async (t) => {
    // Arrange
    const admin = await seedUser(t, { role: 'admin' })
    mailerPlugin.clearTestMessages()

    // Act
    const response = await admin.app.inject({
      method: 'POST',
      url: '/users/invites',
      headers: { Authorization: `Bearer ${admin.accessToken}` },
      payload: {},
    })

    // Assert
    assert.equal(response.statusCode, 201)
    const invite = response.json().data
    assert.ok(invite.id)
    assert.ok(invite.inviteToken.startsWith(`${invite.id}.`))
    assert.equal(invite.email, null)
    assert.equal(invite.role, 'user')
    assert.equal(invite.createdBy, admin.userId)
    assert.equal(invite.consumedAt, null)
    assert.equal(invite.consumedBy, null)
    assert.equal(invite.secretHash, undefined)
    assert.equal(mailerPlugin.getTestMessages().length, 0)
  })

  test('returns 201, normalizes email, assigns role, and dispatches sendInviteMail when email is supplied', async (t) => {
    // Arrange
    const admin = await seedUser(t, { role: 'admin' })
    const targetEmail = randomEmail(10, 5)
    mailerPlugin.clearTestMessages()

    // Act
    const response = await admin.app.inject({
      method: 'POST',
      url: '/users/invites',
      headers: { Authorization: `Bearer ${admin.accessToken}` },
      payload: {
        email: targetEmail.toUpperCase(),
        role: 'admin',
        ttlHours: 24,
      },
    })

    // Assert
    assert.equal(response.statusCode, 201)
    const invite = response.json().data
    assert.equal(invite.email, targetEmail.toLowerCase())
    assert.equal(invite.role, 'admin')
    assert.equal(invite.secretHash, undefined)

    const sent = mailerPlugin.getTestMessages()
    assert.equal(sent.length, 1)
    assert.equal(sent[0].to, targetEmail.toLowerCase())
    assert.ok(sent[0].text.includes(invite.inviteToken))
  })

  test('returns 400 when email format, role, or ttlHours violates schema bounds', async (t) => {
    // Arrange
    const admin = await seedUser(t, { role: 'admin' })

    // Act
    const badEmailRes = await admin.app.inject({
      method: 'POST',
      url: '/users/invites',
      headers: { Authorization: `Bearer ${admin.accessToken}` },
      payload: { email: 'not-an-email' },
    })
    const badRoleRes = await admin.app.inject({
      method: 'POST',
      url: '/users/invites',
      headers: { Authorization: `Bearer ${admin.accessToken}` },
      payload: { role: 'superadmin' },
    })
    const badTtlRes = await admin.app.inject({
      method: 'POST',
      url: '/users/invites',
      headers: { Authorization: `Bearer ${admin.accessToken}` },
      payload: { ttlHours: 0 },
    })

    // Assert
    assert.equal(badEmailRes.statusCode, 400)
    assert.equal(badRoleRes.statusCode, 400)
    assert.equal(badTtlRes.statusCode, 400)
  })

  test('returns 401 when unauthenticated', async (t) => {
    // Arrange
    const { app } = await seedUser(t)

    // Act
    const response = await app.inject({
      method: 'POST',
      url: '/users/invites',
      payload: {},
    })

    // Assert
    assert.equal(response.statusCode, 401)
  })

  test('returns 403 when caller is a regular non-admin user', async (t) => {
    // Arrange
    const regularUser = await seedUser(t, { role: 'user' })

    // Act
    const response = await regularUser.app.inject({
      method: 'POST',
      url: '/users/invites',
      headers: { Authorization: `Bearer ${regularUser.accessToken}` },
      payload: {},
    })

    // Assert
    assert.equal(response.statusCode, 403)
  })
})
