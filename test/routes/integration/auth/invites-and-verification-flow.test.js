'use strict'

const { randomUUIDv7 } = require('node:crypto')
const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { buildApp } = require('../../../test-setup')
const { randomEmail, randomPassword, randomUsername } = require('../../../utils/data-creator')
const { seedUser } = require('../../../utils/setup-user')
const { extractEmailVerificationToken } = require('../../../utils/auth-helpers')
const mailerPlugin = require('../../../../plugins/mailer')

describe('Invites & Email Verification Lifecycle', () => {
  test('enforces single-use email-bound invitations end-to-end across register, login, and revoke', async (t) => {
    // Arrange
    const admin = await seedUser(t, { role: 'admin', env: { REGISTRATION_MODE: 'invite' } })
    const regularUser = await seedUser(t, { app: admin.app, role: 'user' })
    const targetEmail = randomEmail(10, 5)
    mailerPlugin.clearTestMessages()

    // Non-admin cannot create or list invites
    const nonAdminCreateRes = await admin.app.inject({
      method: 'POST',
      url: '/users/invites',
      headers: { Authorization: `Bearer ${regularUser.accessToken}` },
      payload: {},
    })
    assert.equal(nonAdminCreateRes.statusCode, 403)

    const nonAdminListRes = await admin.app.inject({
      method: 'GET',
      url: '/users/invites',
      headers: { Authorization: `Bearer ${regularUser.accessToken}` },
    })
    assert.equal(nonAdminListRes.statusCode, 403)

    // Act: admin creates an email-bound invite and dispatches mail
    const createInviteRes = await admin.app.inject({
      method: 'POST',
      url: '/users/invites',
      headers: { Authorization: `Bearer ${admin.accessToken}` },
      payload: { email: targetEmail.toUpperCase(), role: 'user', ttlHours: 24 },
    })

    // Assert
    assert.equal(createInviteRes.statusCode, 201)
    const inviteData = createInviteRes.json().data
    assert.ok(inviteData.id)
    assert.ok(inviteData.inviteToken.includes('.'))
    assert.equal(inviteData.email, targetEmail.toLowerCase())

    const sentInviteMails = mailerPlugin.getTestMessages()
    assert.equal(sentInviteMails.length, 1)
    assert.equal(sentInviteMails[0].to, targetEmail.toLowerCase())
    assert.ok(sentInviteMails[0].text.includes(inviteData.inviteToken))

    const listInvitesRes = await admin.app.inject({
      method: 'GET',
      url: '/users/invites',
      headers: { Authorization: `Bearer ${admin.accessToken}` },
    })
    assert.equal(listInvitesRes.statusCode, 200)
    const listedInvite = listInvitesRes.json().data.find((inv) => inv.id === inviteData.id)
    assert.ok(listedInvite)
    assert.equal(listedInvite.secretHash, undefined)

    // Invited user registers and verifies emailVerified: true via GET /users/me
    const username = randomUsername(12)
    const password = randomPassword(14)
    const registerRes = await admin.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        username,
        email: targetEmail,
        password,
        inviteToken: inviteData.inviteToken,
      },
    })
    assert.equal(registerRes.statusCode, 201)

    const loginRes = await admin.app.inject({
      method: 'POST',
      url: '/auth/authenticate',
      payload: { username, password },
    })
    assert.equal(loginRes.statusCode, 200)
    assert.equal(loginRes.json().user.emailVerified, true)

    const meRes = await admin.app.inject({
      method: 'GET',
      url: '/users/me',
      headers: { Authorization: `Bearer ${loginRes.json().access_token}` },
    })
    assert.equal(meRes.statusCode, 200)
    assert.equal(meRes.json().data.emailVerified, true)

    // Non-admin cannot revoke an invite; admin revoke rejects missing IDs and invalidates unused tokens
    const secondInviteRes = await admin.app.inject({
      method: 'POST',
      url: '/users/invites',
      headers: { Authorization: `Bearer ${admin.accessToken}` },
      payload: {},
    })
    assert.equal(secondInviteRes.statusCode, 201)
    const secondInvite = secondInviteRes.json().data

    const nonAdminRevokeRes = await admin.app.inject({
      method: 'DELETE',
      url: `/users/invites/${secondInvite.id}`,
      headers: { Authorization: `Bearer ${regularUser.accessToken}` },
    })
    assert.equal(nonAdminRevokeRes.statusCode, 403)

    const missingRevokeRes = await admin.app.inject({
      method: 'DELETE',
      url: `/users/invites/${randomUUIDv7()}`,
      headers: { Authorization: `Bearer ${admin.accessToken}` },
    })
    assert.equal(missingRevokeRes.statusCode, 404)

    const revokeRes = await admin.app.inject({
      method: 'DELETE',
      url: `/users/invites/${secondInvite.id}`,
      headers: { Authorization: `Bearer ${admin.accessToken}` },
    })
    assert.equal(revokeRes.statusCode, 204)

    const revokedRegRes = await admin.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        username: randomUsername(12),
        email: randomEmail(10, 5),
        password: randomPassword(14),
        inviteToken: secondInvite.inviteToken,
      },
    })
    assert.equal(revokedRegRes.statusCode, 403)
  })

  test('open registration starts unverified, completes verification, and resets emailVerified on email change', async (t) => {
    // Arrange
    const app = await buildApp(t, { REGISTRATION_MODE: 'open' })
    const username = randomUsername(12)
    const email = randomEmail(10, 5)
    const password = randomPassword(14)

    const regRes = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username, email, password },
    })
    assert.equal(regRes.statusCode, 201)

    const loginRes = await app.inject({
      method: 'POST',
      url: '/auth/authenticate',
      payload: { username, password },
    })
    assert.equal(loginRes.statusCode, 200)
    const { access_token: accessToken, user } = loginRes.json()
    assert.equal(user.emailVerified, false)

    // Act
    mailerPlugin.clearTestMessages()
    const reqVerifyRes = await app.inject({
      method: 'POST',
      url: '/auth/verify-email/request',
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: {},
    })
    assert.equal(reqVerifyRes.statusCode, 200)
    const token = extractEmailVerificationToken(mailerPlugin.getTestMessages()[0].text)

    const confirmRes = await app.inject({
      method: 'POST',
      url: '/auth/verify-email/confirm',
      payload: { email, token },
    })

    // Assert
    assert.equal(confirmRes.statusCode, 200)
    assert.deepEqual(confirmRes.json(), { verified: true })

    const meAfterRes = await app.inject({
      method: 'GET',
      url: '/users/me',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    assert.equal(meAfterRes.statusCode, 200)
    assert.equal(meAfterRes.json().data.emailVerified, true)

    const updateEmailRes = await app.inject({
      method: 'PUT',
      url: '/users/me',
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { email: randomEmail(10, 5) },
    })
    assert.equal(updateEmailRes.statusCode, 200)
    assert.equal(updateEmailRes.json().data.emailVerified, false)
  })
})
