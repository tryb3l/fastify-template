'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { buildApp } = require('../../test-setup')
const { randomUsername, randomEmail, randomPassword } = require('../../utils/data-creator')
const { seedUser } = require('../../utils/setup-user')

async function registerUser(app, payload) {
  return await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload,
  })
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
    const admin = await seedUser(t, { role: 'admin', env: { REGISTRATION_MODE: 'invite' } })
    const targetEmail = randomEmail(10, 5)
    const invite = await admin.app.usersDataSource.createInvite({
      email: targetEmail.toUpperCase(),
      role: 'admin',
      ttlHours: 24,
      createdBy: admin.userId,
    })
    const payload = {
      username: randomUsername(12),
      email: targetEmail,
      password: randomPassword(14),
      inviteToken: invite.inviteToken,
    }

    // Act
    const response = await registerUser(admin.app, payload)

    // Assert
    assert.equal(response.statusCode, 201)
    assert.deepEqual(response.json(), { registered: true })

    const created = await admin.app.usersDataSource.readUserWithHash(payload.username)
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
    const admin = await seedUser(t, { role: 'admin', env: { REGISTRATION_MODE: 'invite' } })
    const invite = await admin.app.usersDataSource.createInvite({
      email: randomEmail(10, 5),
      role: 'user',
      ttlHours: 24,
      createdBy: admin.userId,
    })

    // Act
    const response = await registerUser(admin.app, {
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
    const admin = await seedUser(t, { role: 'admin', env: { REGISTRATION_MODE: 'invite' } })
    const consumedInvite = await admin.app.usersDataSource.createInvite({
      role: 'user',
      ttlHours: 24,
      createdBy: admin.userId,
    })
    const firstSignup = await registerUser(admin.app, {
      username: randomUsername(12),
      email: randomEmail(10, 5),
      password: randomPassword(14),
      inviteToken: consumedInvite.inviteToken,
    })
    assert.equal(firstSignup.statusCode, 201)

    // Act
    const response = await registerUser(admin.app, {
      username: randomUsername(12),
      email: randomEmail(10, 5),
      password: randomPassword(14),
      inviteToken: consumedInvite.inviteToken,
    })

    // Assert
    assert.equal(response.statusCode, 403)
  })

  test('returns 403 when inviteToken is revoked or tampered', async (t) => {
    // Arrange
    const admin = await seedUser(t, { role: 'admin', env: { REGISTRATION_MODE: 'invite' } })
    const revokedInvite = await admin.app.usersDataSource.createInvite({
      role: 'user',
      ttlHours: 24,
      createdBy: admin.userId,
    })
    await admin.app.usersDataSource.revokeInvite(revokedInvite.id)

    // Act
    const revokedResponse = await registerUser(admin.app, {
      username: randomUsername(12),
      email: randomEmail(10, 5),
      password: randomPassword(14),
      inviteToken: revokedInvite.inviteToken,
    })
    const tamperedResponse = await registerUser(admin.app, {
      username: randomUsername(12),
      email: randomEmail(10, 5),
      password: randomPassword(14),
      inviteToken: `${revokedInvite.id}.${'0'.repeat(64)}`,
    })

    // Assert
    assert.equal(revokedResponse.statusCode, 403)
    assert.equal(tamperedResponse.statusCode, 403)
  })

  test('returns 409 when username or email is already registered', async (t) => {
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
    const duplicateUsernameRes = await registerUser(app, {
      username: existingPayload.username.toUpperCase(),
      email: randomEmail(10, 5),
      password: randomPassword(14),
    })
    const duplicateEmailRes = await registerUser(app, {
      username: randomUsername(12),
      email: existingPayload.email.toUpperCase(),
      password: randomPassword(14),
    })

    // Assert
    assert.equal(duplicateUsernameRes.statusCode, 409)
    assert.ok(duplicateUsernameRes.json().message.includes('User already registered'))
    assert.equal(duplicateEmailRes.statusCode, 409)
    assert.ok(duplicateEmailRes.json().message.includes('User already registered'))
  })
})
