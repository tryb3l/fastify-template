'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { buildApp, getTestMongoUrl } = require('../../../test-setup')
const { randomUsername, randomEmail, randomPassword } = require('../../../utils/data-creator')

function replaceDatabaseName(mongoUrl, databaseName) {
  return mongoUrl.replace(/\/[^/?]+(?=$|\?)/, `/${databaseName}`)
}

async function buildRegisterApp(t) {
  return buildApp(t, {
    MONGO_URL: replaceDatabaseName(getTestMongoUrl(), 'login-test-db'),
  })
}

async function registerUser(app, payload) {
  return app.inject({
    method: 'POST',
    url: '/auth/register',
    payload,
  })
}

test('POST /auth/register 201 - register the user successfully', async (t) => {
  // Arrange
  const app = await buildRegisterApp(t)

  const payload = {
    username: randomUsername(),
    email: randomEmail(),
    password: randomPassword(),
  }

  // Act
  const response = await registerUser(app, payload)

  // Assert
  assert.strictEqual(response.statusCode, 201)
  assert.deepStrictEqual(response.json(), { registered: true })
})

test('POST /auth/register 409 - conflict on existing user', async (t) => {
  // Arrange
  const app = await buildRegisterApp(t)

  const payload = {
    username: randomUsername(),
    email: randomEmail(),
    password: randomPassword(),
  }

  const existingUserResponse = await registerUser(app, payload)
  assert.strictEqual(existingUserResponse.statusCode, 201)

  // Act
  const response = await registerUser(app, payload)

  // Assert
  assert.strictEqual(response.statusCode, 409)
  assert.ok(response.json().message.includes('User already registered'))
})

test('POST /auth/register 400 - failed signup, invalid email format', async (t) => {
  // Arrange
  const app = await buildRegisterApp(t)

  const payload = {
    username: randomUsername(),
    password: randomPassword(),
    email: 'fake#email.com',
  }

  // Act
  const response = await registerUser(app, payload)

  // Assert
  assert.strictEqual(response.statusCode, 400)
  assert.ok(response.json().message)
})

test('POST /auth/register 400 - failed signup, missing required field (password)', async (t) => {
  // Arrange
  const app = await buildRegisterApp(t)

  const payload = {
    username: randomUsername(),
    email: randomEmail(),
    // Missing password
  }

  // Act
  const response = await registerUser(app, payload)

  // Assert
  assert.strictEqual(response.statusCode, 400)
  assert.ok(response.json().message)
})

test('POST /auth/register 400 - failed signup, weak password policy violation', async (t) => {
  // Arrange
  const app = await buildRegisterApp(t)

  const payload = {
    username: randomUsername(),
    email: randomEmail(),
    password: 'weakpass',
  }

  // Act
  const response = await registerUser(app, payload)

  // Assert
  assert.strictEqual(response.statusCode, 400)
  assert.ok(response.json().message)
})

test('POST /auth/register 403 - rejects registration when REGISTRATION_MODE is closed', async (t) => {
  const app = await buildApp(t, {
    MONGO_URL: replaceDatabaseName(getTestMongoUrl(), 'login-test-db'),
    REGISTRATION_MODE: 'closed',
  })

  const response = await registerUser(app, {
    username: randomUsername(),
    email: randomEmail(),
    password: randomPassword(),
  })

  assert.strictEqual(response.statusCode, 403)
})

test('POST /auth/register - enforces single-use and email-bound invitations when REGISTRATION_MODE is invite', async (t) => {
  const { setup } = require('../../../utils/setup-user')
  const adminContext = await setup(t, 'admin', {
    MONGO_URL: replaceDatabaseName(getTestMongoUrl(), 'login-test-db'),
    REGISTRATION_MODE: 'open',
  })

  const inviteApp = await buildApp(t, {
    MONGO_URL: replaceDatabaseName(getTestMongoUrl(), 'login-test-db'),
    REGISTRATION_MODE: 'invite',
  })

  // Uninvited attempt fails with 403
  const uninvitedRes = await registerUser(inviteApp, {
    username: randomUsername(),
    email: randomEmail(),
    password: randomPassword(),
  })
  assert.strictEqual(uninvitedRes.statusCode, 403)

  // Admin creates an email-bound invite
  const targetEmail = randomEmail()
  const createInviteRes = await adminContext.app.inject({
    method: 'POST',
    url: '/users/invites',
    headers: { Authorization: `Bearer ${adminContext.accessToken}` },
    payload: { email: targetEmail.toUpperCase(), role: 'user', ttlHours: 24 },
  })
  assert.strictEqual(createInviteRes.statusCode, 201)
  const inviteData = createInviteRes.json().data
  assert.ok(inviteData.id)
  assert.ok(inviteData.inviteToken.includes('.'))
  assert.strictEqual(inviteData.email, targetEmail.toLowerCase())

  // Admin lists invites (secretHash must not be exposed)
  const listInvitesRes = await adminContext.app.inject({
    method: 'GET',
    url: '/users/invites',
    headers: { Authorization: `Bearer ${adminContext.accessToken}` },
  })
  assert.strictEqual(listInvitesRes.statusCode, 200)
  const foundInvite = listInvitesRes.json().data.find((inv) => inv.id === inviteData.id)
  assert.ok(foundInvite)
  assert.strictEqual(foundInvite.secretHash, undefined)

  // Mismatched email is rejected with 403
  const wrongEmailRes = await registerUser(inviteApp, {
    username: randomUsername(),
    email: randomEmail(),
    password: randomPassword(),
    inviteToken: inviteData.inviteToken,
  })
  assert.strictEqual(wrongEmailRes.statusCode, 403)

  // Matching email succeeds with 201
  const validInviteRes = await registerUser(inviteApp, {
    username: randomUsername(),
    email: targetEmail,
    password: randomPassword(),
    inviteToken: inviteData.inviteToken,
  })
  assert.strictEqual(validInviteRes.statusCode, 201)

  // Non-admin cannot create, list, or revoke invites
  const regularUserContext = await setup(t, 'user', {
    MONGO_URL: replaceDatabaseName(getTestMongoUrl(), 'login-test-db'),
    REGISTRATION_MODE: 'open',
  })
  const nonAdminCreateInviteRes = await regularUserContext.app.inject({
    method: 'POST',
    url: '/users/invites',
    headers: { Authorization: `Bearer ${regularUserContext.accessToken}` },
    payload: {},
  })
  assert.strictEqual(nonAdminCreateInviteRes.statusCode, 403)

  const nonAdminListInvitesRes = await regularUserContext.app.inject({
    method: 'GET',
    url: '/users/invites',
    headers: { Authorization: `Bearer ${regularUserContext.accessToken}` },
  })
  assert.strictEqual(nonAdminListInvitesRes.statusCode, 403)

  // Admin can create an admin-role invite and the registered user receives role: 'admin'
  const adminRoleInviteRes = await adminContext.app.inject({
    method: 'POST',
    url: '/users/invites',
    headers: { Authorization: `Bearer ${adminContext.accessToken}` },
    payload: { role: 'admin', ttlHours: 1 },
  })
  assert.strictEqual(adminRoleInviteRes.statusCode, 201)
  const adminInviteToken = adminRoleInviteRes.json().data.inviteToken
  const invitedAdminUsername = randomUsername()
  const invitedAdminPassword = randomPassword()

  const invitedAdminRegRes = await registerUser(inviteApp, {
    username: invitedAdminUsername,
    email: randomEmail(),
    password: invitedAdminPassword,
    inviteToken: adminInviteToken,
  })
  assert.strictEqual(invitedAdminRegRes.statusCode, 201)

  const invitedAdminLoginRes = await inviteApp.inject({
    method: 'POST',
    url: '/auth/authenticate',
    payload: { username: invitedAdminUsername, password: invitedAdminPassword },
  })
  assert.strictEqual(invitedAdminLoginRes.statusCode, 200)
  assert.strictEqual(invitedAdminLoginRes.json().user.role, 'admin')

  // Malformed or tampered invite tokens are rejected with 403
  const tamperedInviteRes = await registerUser(inviteApp, {
    username: randomUsername(),
    email: randomEmail(),
    password: randomPassword(),
    inviteToken: `${inviteData.id}.${'0'.repeat(64)}`,
  })
  assert.strictEqual(tamperedInviteRes.statusCode, 403)

  // Re-using the consumed invite is rejected with 403
  const replayInviteRes = await registerUser(inviteApp, {
    username: randomUsername(),
    email: randomEmail(),
    password: randomPassword(),
    inviteToken: inviteData.inviteToken,
  })
  assert.strictEqual(replayInviteRes.statusCode, 403)

  // Admin creates and revokes an invite
  const secondInviteRes = await adminContext.app.inject({
    method: 'POST',
    url: '/users/invites',
    headers: { Authorization: `Bearer ${adminContext.accessToken}` },
    payload: {},
  })
  assert.strictEqual(secondInviteRes.statusCode, 201)
  const secondInvite = secondInviteRes.json().data

  const revokeRes = await adminContext.app.inject({
    method: 'DELETE',
    url: `/users/invites/${secondInvite.id}`,
    headers: { Authorization: `Bearer ${adminContext.accessToken}` },
  })
  assert.strictEqual(revokeRes.statusCode, 204)

  const revokedRegisterRes = await registerUser(inviteApp, {
    username: randomUsername(),
    email: randomEmail(),
    password: randomPassword(),
    inviteToken: secondInvite.inviteToken,
  })
  assert.strictEqual(revokedRegisterRes.statusCode, 403)
})
