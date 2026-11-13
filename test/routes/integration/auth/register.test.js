'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { buildApp, getTestMongoUrl } = require('../../../test-setup')
const { randomUsername, randomEmail, randomPassword } = require('../../../utils/data-creator')
const mailerPlugin = require('../../../../plugins/mailer')

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
  mailerPlugin.clearTestMessages()
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

  // Invite email was dispatched via fastify.mailer.sendInviteMail
  const sentInviteMails = mailerPlugin.getTestMessages()
  assert.strictEqual(sentInviteMails.length, 1)
  assert.strictEqual(sentInviteMails[0].to, targetEmail.toLowerCase())
  assert.ok(sentInviteMails[0].text.includes(inviteData.inviteToken))

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

  // Matching email succeeds with 201 and sets emailVerified: true immediately
  const invitedUserUsername = randomUsername()
  const invitedUserPassword = randomPassword()
  const validInviteRes = await registerUser(inviteApp, {
    username: invitedUserUsername,
    email: targetEmail,
    password: invitedUserPassword,
    inviteToken: inviteData.inviteToken,
  })
  assert.strictEqual(validInviteRes.statusCode, 201)

  const invitedUserLoginRes = await inviteApp.inject({
    method: 'POST',
    url: '/auth/authenticate',
    payload: { username: invitedUserUsername, password: invitedUserPassword },
  })
  assert.strictEqual(invitedUserLoginRes.statusCode, 200)
  assert.strictEqual(invitedUserLoginRes.json().user.emailVerified, true)

  const invitedUserMeRes = await inviteApp.inject({
    method: 'GET',
    url: '/users/me',
    headers: { Authorization: `Bearer ${invitedUserLoginRes.json().access_token}` },
  })
  assert.strictEqual(invitedUserMeRes.statusCode, 200)
  assert.strictEqual(invitedUserMeRes.json().data.emailVerified, true)

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

test('Open registration starts with emailVerified: false and completes verification via POST /auth/verify-email/request & /confirm', async (t) => {
  const app = await buildApp(t, {
    MONGO_URL: replaceDatabaseName(getTestMongoUrl(), 'login-test-db'),
    REGISTRATION_MODE: 'open',
  })

  const username = randomUsername()
  const email = randomEmail()
  const password = randomPassword()

  const regRes = await registerUser(app, { username, email, password })
  assert.strictEqual(regRes.statusCode, 201)

  const loginRes = await app.inject({
    method: 'POST',
    url: '/auth/authenticate',
    payload: { username, password },
  })
  assert.strictEqual(loginRes.statusCode, 200)
  const { access_token: accessToken, user } = loginRes.json()
  assert.strictEqual(user.emailVerified, false)

  const meBeforeRes = await app.inject({
    method: 'GET',
    url: '/users/me',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  assert.strictEqual(meBeforeRes.statusCode, 200)
  assert.strictEqual(meBeforeRes.json().data.emailVerified, false)

  // Request email verification link (via authenticated Bearer token without body email)
  mailerPlugin.clearTestMessages()
  const reqVerifyRes = await app.inject({
    method: 'POST',
    url: '/auth/verify-email/request',
    headers: { Authorization: `Bearer ${accessToken}` },
    payload: {},
  })
  assert.strictEqual(reqVerifyRes.statusCode, 200)

  const messages = mailerPlugin.getTestMessages()
  assert.strictEqual(messages.length, 1)
  assert.strictEqual(messages[0].to, email.toLowerCase())
  assert.ok(
    messages[0].text.includes('/verify-email/confirm#token='),
    'Verification email link must pass token in URL fragment (#token=), not query string',
  )
  assert.ok(
    !messages[0].text.includes('/verify-email/confirm?token='),
    'Verification email link must not expose token in URL query string (?token=)',
  )

  const tokenMatch = messages[0].text.match(/Verification token:\s*([0-9a-f-]+\.[0-9a-f]+)/i)
  assert.ok(tokenMatch, 'Expected verification token in email body')
  const verifyToken = tokenMatch[1]

  // Tampered token fails with 401
  const badConfirmRes = await app.inject({
    method: 'POST',
    url: '/auth/verify-email/confirm',
    payload: {
      email,
      token: `${verifyToken.split('.')[0]}.${'0'.repeat(64)}`,
    },
  })
  assert.strictEqual(badConfirmRes.statusCode, 401)

  // Valid token confirms and returns only { verified: true } without leaking user profile fields
  const confirmRes = await app.inject({
    method: 'POST',
    url: '/auth/verify-email/confirm',
    payload: {
      email,
      token: verifyToken,
    },
  })
  assert.strictEqual(confirmRes.statusCode, 200)
  assert.deepStrictEqual(confirmRes.json(), { verified: true })

  // Re-using the same token is rejected with 401
  const replayConfirmRes = await app.inject({
    method: 'POST',
    url: '/auth/verify-email/confirm',
    payload: {
      email,
      token: verifyToken,
    },
  })
  assert.strictEqual(replayConfirmRes.statusCode, 401)

  // Subsequent GET /users/me reflects emailVerified: true
  const meAfterRes = await app.inject({
    method: 'GET',
    url: '/users/me',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  assert.strictEqual(meAfterRes.statusCode, 200)
  assert.strictEqual(meAfterRes.json().data.emailVerified, true)

  // Updating email resets emailVerified back to false
  const updatedEmail = randomEmail()
  const updateEmailRes = await app.inject({
    method: 'PUT',
    url: '/users/me',
    headers: { Authorization: `Bearer ${accessToken}` },
    payload: { email: updatedEmail },
  })
  assert.strictEqual(updateEmailRes.statusCode, 200)
  assert.strictEqual(updateEmailRes.json().data.emailVerified, false)
})
