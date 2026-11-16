'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUIDv7 } = require('node:crypto')
const { buildApp } = require('../../test-setup')
const { setup } = require('../../utils/setup-user')
const { extractEmailVerificationToken, invalidateTokenSecret } = require('../../utils/auth-tokens')
const mailerPlugin = require('../../../plugins/mailer')

describe('POST /auth/verify-email/confirm', () => {
  test('returns 200 verified: true, marks user verified, and writes audit log', async (t) => {
    // Arrange
    const { app, accessToken, email, userId } = await setup(t, 'user', {
      REGISTRATION_MODE: 'open',
    })
    mailerPlugin.clearTestMessages()

    const reqRes = await app.inject({
      method: 'POST',
      url: '/auth/verify-email/request',
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: {},
    })
    assert.equal(reqRes.statusCode, 200)
    const token = extractEmailVerificationToken(mailerPlugin.getTestMessages()[0].text)

    // Act
    const response = await app.inject({
      method: 'POST',
      url: '/auth/verify-email/confirm',
      payload: { email, token },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.deepEqual(response.json(), { verified: true })

    const updatedUser = await app.usersDataSource.readUserDetails(userId)
    assert.equal(updatedUser.emailVerified, true)

    await app.flushAuditLogs()
    const auditLogs = await app.mongo.db
      .collection('auditLogs')
      .find({ action: 'auth_email_verified', userId, resourceId: userId })
      .sort({ createdAt: 1 })
      .toArray()
    assert.equal(auditLogs.length, 1)
  })

  test('returns 401 when attempting to reuse a consumed verification token', async (t) => {
    // Arrange
    const { app, accessToken, email } = await setup(t, 'user', {
      REGISTRATION_MODE: 'open',
    })
    mailerPlugin.clearTestMessages()

    await app.inject({
      method: 'POST',
      url: '/auth/verify-email/request',
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: {},
    })
    const token = extractEmailVerificationToken(mailerPlugin.getTestMessages()[0].text)

    const firstConfirm = await app.inject({
      method: 'POST',
      url: '/auth/verify-email/confirm',
      payload: { email, token },
    })
    assert.equal(firstConfirm.statusCode, 200)

    // Act
    const response = await app.inject({
      method: 'POST',
      url: '/auth/verify-email/confirm',
      payload: { email, token },
    })

    // Assert
    assert.equal(response.statusCode, 401)
    assert.equal(response.json().message, 'Invalid or expired email verification token')
  })

  test('returns 400 when token is missing', async (t) => {
    // Arrange
    const app = await buildApp(t)

    // Act
    const response = await app.inject({
      method: 'POST',
      url: '/auth/verify-email/confirm',
      payload: {},
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 400 when token is shorter than schema minimum', async (t) => {
    // Arrange
    const app = await buildApp(t)

    // Act
    const response = await app.inject({
      method: 'POST',
      url: '/auth/verify-email/confirm',
      payload: { token: 'short' },
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 401 when verification token secret is invalid', async (t) => {
    // Arrange
    const { app, accessToken, email } = await setup(t, 'user', { REGISTRATION_MODE: 'open' })
    mailerPlugin.clearTestMessages()

    await app.inject({
      method: 'POST',
      url: '/auth/verify-email/request',
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: {},
    })
    const token = extractEmailVerificationToken(mailerPlugin.getTestMessages()[0].text)
    const separator = token.indexOf('.')
    const tamperedToken = `${token.slice(0, separator)}.${invalidateTokenSecret(token.slice(separator + 1))}`

    // Act
    const response = await app.inject({
      method: 'POST',
      url: '/auth/verify-email/confirm',
      payload: { email, token: tamperedToken },
    })

    // Assert
    assert.equal(response.statusCode, 401)
    assert.equal(response.json().message, 'Invalid or expired email verification token')
  })

  test('returns 401 when verification token email does not match owner email', async (t) => {
    // Arrange
    const { app, accessToken } = await setup(t, 'user', { REGISTRATION_MODE: 'open' })
    mailerPlugin.clearTestMessages()

    await app.inject({
      method: 'POST',
      url: '/auth/verify-email/request',
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: {},
    })
    const token = extractEmailVerificationToken(mailerPlugin.getTestMessages()[0].text)

    // Act
    const response = await app.inject({
      method: 'POST',
      url: '/auth/verify-email/confirm',
      payload: { email: 'different-user@example.com', token },
    })

    // Assert
    assert.equal(response.statusCode, 401)
  })

  test('returns 401 when verification token id is unknown', async (t) => {
    // Arrange
    const app = await buildApp(t)

    // Act
    const response = await app.inject({
      method: 'POST',
      url: '/auth/verify-email/confirm',
      payload: { token: `${randomUUIDv7()}.${'0'.repeat(64)}` },
    })

    // Assert
    assert.equal(response.statusCode, 401)
  })

  test('returns 401 when verification token is expired', async (t) => {
    // Arrange
    const { app, accessToken, email, userId } = await setup(t, 'user', {
      REGISTRATION_MODE: 'open',
    })
    mailerPlugin.clearTestMessages()

    await app.inject({
      method: 'POST',
      url: '/auth/verify-email/request',
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: {},
    })
    const token = extractEmailVerificationToken(mailerPlugin.getTestMessages()[0].text)

    await app.mongo.db
      .collection('users')
      .updateOne(
        { _id: userId },
        { $set: { 'emailVerification.expiresAt': new Date('2020-01-01T00:00:00.000Z') } },
      )

    // Act
    const response = await app.inject({
      method: 'POST',
      url: '/auth/verify-email/confirm',
      payload: { email, token },
    })

    // Assert
    assert.equal(response.statusCode, 401)
    assert.equal(response.json().message, 'Invalid or expired email verification token')
  })
})
