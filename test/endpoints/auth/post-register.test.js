'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { buildApp } = require('../../test-setup')
const { randomUsername, randomEmail, randomPassword } = require('../../utils/data-creator')
const { setup } = require('../../utils/setup-user')

async function registerUser(app, payload) {
  return await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload,
  })
}

async function createInviteViaHttpAdmin(t, payload = {}) {
  const admin = await setup(t, 'admin', { REGISTRATION_MODE: 'open' })
  const inviteApp = await buildApp(t, { REGISTRATION_MODE: 'invite' })
  const createRes = await admin.app.inject({
    method: 'POST',
    url: '/users/invites',
    headers: { Authorization: `Bearer ${admin.accessToken}` },
    payload,
  })
  assert.equal(createRes.statusCode, 201)
  return {
    admin,
    inviteApp,
    invite: createRes.json().data,
  }
}

describe('POST /auth/register', () => {
  test('returns 201 and creates user with Argon2id hash in open mode', async (t) => {
    // Arrange
    const app = await buildApp(t, { REGISTRATION_MODE: 'open' })
    const payload = {
      username: randomUsername(12),
      email: randomEmail(10, 5),
      password: randomPassword(14),
    }

    // Act
    const response = await registerUser(app, payload)

    // Assert
    assert.equal(response.statusCode, 201)
    assert.deepEqual(response.json(), { registered: true })

    const created = await app.usersDataSource.readUserWithHash(payload.username)
    assert.ok(created)
    assert.equal(created.emailVerified, false)
    assert.equal(created.role, 'user')
    assert.ok(created.hash.startsWith('$argon2id$'))

    const loginRes = await app.inject({
      method: 'POST',
      url: '/auth/authenticate',
      payload: { username: payload.username, password: payload.password },
    })
    assert.equal(loginRes.statusCode, 200)
  })

  test('returns 201 with verified email and assigned role when consuming a single-use invite token', async (t) => {
    // Arrange
    const targetEmail = randomEmail(10, 5)
    const { inviteApp, invite } = await createInviteViaHttpAdmin(t, {
      email: targetEmail.toUpperCase(),
      role: 'admin',
      ttlHours: 24,
    })
    const payload = {
      username: randomUsername(12),
      email: targetEmail,
      password: randomPassword(14),
      inviteToken: invite.inviteToken,
    }

    // Act
    const response = await registerUser(inviteApp, payload)

    // Assert
    assert.equal(response.statusCode, 201)
    assert.deepEqual(response.json(), { registered: true })

    const created = await inviteApp.usersDataSource.readUserWithHash(payload.username)
    assert.ok(created)
    assert.equal(created.emailVerified, true)
    assert.equal(created.role, 'admin')
  })

  test('returns 400 when required password field is missing', async (t) => {
    // Arrange
    const app = await buildApp(t, { REGISTRATION_MODE: 'open' })

    // Act
    const response = await registerUser(app, {
      username: randomUsername(12),
      email: randomEmail(10, 5),
    })

    // Assert
    assert.equal(response.statusCode, 400)
    assert.ok(response.json().message)
  })

  test('returns 400 when email format is invalid', async (t) => {
    // Arrange
    const app = await buildApp(t, { REGISTRATION_MODE: 'open' })

    // Act
    const response = await registerUser(app, {
      username: randomUsername(12),
      email: 'fake#email.com',
      password: randomPassword(14),
    })

    // Assert
    assert.equal(response.statusCode, 400)
    assert.ok(response.json().message)
  })

  test('returns 400 when password violates complexity policy', async (t) => {
    // Arrange
    const app = await buildApp(t, { REGISTRATION_MODE: 'open' })

    // Act
    const response = await registerUser(app, {
      username: randomUsername(12),
      email: randomEmail(10, 5),
      password: 'weakpass',
    })

    // Assert
    assert.equal(response.statusCode, 400)
    assert.ok(response.json().message)
  })

  test('returns 403 when REGISTRATION_MODE is closed', async (t) => {
    // Arrange
    const app = await buildApp(t, { REGISTRATION_MODE: 'closed' })

    // Act
    const response = await registerUser(app, {
      username: randomUsername(12),
      email: randomEmail(10, 5),
      password: randomPassword(14),
    })

    // Assert
    assert.equal(response.statusCode, 403)
  })

  test('returns 403 when REGISTRATION_MODE is invite and inviteToken is missing', async (t) => {
    // Arrange
    const app = await buildApp(t, { REGISTRATION_MODE: 'invite' })

    // Act
    const response = await registerUser(app, {
      username: randomUsername(12),
      email: randomEmail(10, 5),
      password: randomPassword(14),
    })

    // Assert
    assert.equal(response.statusCode, 403)
  })

  test('returns 403 when inviteToken is bound to a different email address', async (t) => {
    // Arrange
    const { inviteApp, invite } = await createInviteViaHttpAdmin(t, {
      email: randomEmail(10, 5),
      role: 'user',
      ttlHours: 24,
    })

    // Act
    const response = await registerUser(inviteApp, {
      username: randomUsername(12),
      email: randomEmail(10, 5),
      password: randomPassword(14),
      inviteToken: invite.inviteToken,
    })

    // Assert
    assert.equal(response.statusCode, 403)
  })

  test('returns 403 when inviteToken is already consumed', async (t) => {
    // Arrange
    const { inviteApp, invite } = await createInviteViaHttpAdmin(t, {
      role: 'user',
      ttlHours: 24,
    })
    const firstSignup = await registerUser(inviteApp, {
      username: randomUsername(12),
      email: randomEmail(10, 5),
      password: randomPassword(14),
      inviteToken: invite.inviteToken,
    })
    assert.equal(firstSignup.statusCode, 201)

    // Act
    const response = await registerUser(inviteApp, {
      username: randomUsername(12),
      email: randomEmail(10, 5),
      password: randomPassword(14),
      inviteToken: invite.inviteToken,
    })

    // Assert
    assert.equal(response.statusCode, 403)
  })

  test('returns 403 when inviteToken is revoked', async (t) => {
    // Arrange
    const { admin, inviteApp, invite } = await createInviteViaHttpAdmin(t, {
      role: 'user',
      ttlHours: 24,
    })
    const revokeRes = await admin.app.inject({
      method: 'DELETE',
      url: `/users/invites/${invite.id}`,
      headers: { Authorization: `Bearer ${admin.accessToken}` },
    })
    assert.equal(revokeRes.statusCode, 204)

    // Act
    const response = await registerUser(inviteApp, {
      username: randomUsername(12),
      email: randomEmail(10, 5),
      password: randomPassword(14),
      inviteToken: invite.inviteToken,
    })

    // Assert
    assert.equal(response.statusCode, 403)
  })

  test('returns 403 when inviteToken secret is tampered', async (t) => {
    // Arrange
    const { inviteApp, invite } = await createInviteViaHttpAdmin(t, {
      role: 'user',
      ttlHours: 24,
    })

    // Act
    const response = await registerUser(inviteApp, {
      username: randomUsername(12),
      email: randomEmail(10, 5),
      password: randomPassword(14),
      inviteToken: `${invite.id}.${'0'.repeat(64)}`,
    })

    // Assert
    assert.equal(response.statusCode, 403)
  })

  test('returns 409 when username is already registered', async (t) => {
    // Arrange
    const app = await buildApp(t, { REGISTRATION_MODE: 'open' })
    const existingPayload = {
      username: randomUsername(12),
      email: randomEmail(10, 5),
      password: randomPassword(14),
    }
    const firstResponse = await registerUser(app, existingPayload)
    assert.equal(firstResponse.statusCode, 201)

    // Act
    const response = await registerUser(app, {
      username: existingPayload.username.toUpperCase(),
      email: randomEmail(10, 5),
      password: randomPassword(14),
    })

    // Assert
    assert.equal(response.statusCode, 409)
    assert.ok(response.json().message.includes('User already registered'))
  })

  test('returns 409 when email is already registered', async (t) => {
    // Arrange
    const app = await buildApp(t, { REGISTRATION_MODE: 'open' })
    const existingPayload = {
      username: randomUsername(12),
      email: randomEmail(10, 5),
      password: randomPassword(14),
    }
    const firstResponse = await registerUser(app, existingPayload)
    assert.equal(firstResponse.statusCode, 201)

    // Act
    const response = await registerUser(app, {
      username: randomUsername(12),
      email: existingPayload.email.toUpperCase(),
      password: randomPassword(14),
    })

    // Assert
    assert.equal(response.statusCode, 409)
    assert.ok(response.json().message.includes('User already registered'))
  })
})
