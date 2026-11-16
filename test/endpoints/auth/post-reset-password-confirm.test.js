'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUIDv7 } = require('node:crypto')
const { setImmediate: nextImmediate } = require('node:timers/promises')
const { buildApp } = require('../../test-setup')
const { setup } = require('../../utils/setup-user')
const { randomPassword } = require('../../utils/data-creator')
const { buildRefreshTokenCookieHeader, issueCsrfContext } = require('../../utils/csrf')
const { extractResetToken, invalidateTokenSecret } = require('../../utils/auth-tokens')
const mailerPlugin = require('../../../plugins/mailer')

describe('POST /auth/reset-password/confirm', () => {
  test('returns 200, updates password hash via Argon2id, and allows login with new password', async (t) => {
    // Arrange
    const { app, email } = await setup(t, 'user')
    const newPassword = randomPassword(16)
    mailerPlugin.clearTestMessages()

    const requestRes = await app.inject({
      method: 'POST',
      url: '/auth/reset-password/request',
      payload: { email },
    })
    assert.equal(requestRes.statusCode, 200)
    const { resetId, secret } = extractResetToken(mailerPlugin.getTestMessages()[0].text)

    // Act
    const response = await app.inject({
      method: 'POST',
      url: '/auth/reset-password/confirm',
      payload: { resetId, secret, newPassword },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.equal(
      response.json().message,
      'Password has been successfully reset. You may now log in.',
    )

    const newPasswordLogin = await app.inject({
      method: 'POST',
      url: '/auth/authenticate',
      payload: { email, password: newPassword },
    })
    assert.equal(newPasswordLogin.statusCode, 200)
    await nextImmediate()
    await app.flushAuditLogs()
  })

  test('returns 200 and invalidates old password, active sessions, and writes audit event', async (t) => {
    // Arrange
    const { app, email, password, userId, accessToken, refreshToken } = await setup(t, 'user')
    const newPassword = randomPassword(16)
    mailerPlugin.clearTestMessages()

    const requestRes = await app.inject({
      method: 'POST',
      url: '/auth/reset-password/request',
      payload: { email },
    })
    assert.equal(requestRes.statusCode, 200)
    const { resetId, secret } = extractResetToken(mailerPlugin.getTestMessages()[0].text)

    // Act
    const response = await app.inject({
      method: 'POST',
      url: '/auth/reset-password/confirm',
      payload: { resetId, secret, newPassword },
    })

    // Assert
    assert.equal(response.statusCode, 200)

    const oldPasswordLogin = await app.inject({
      method: 'POST',
      url: '/auth/authenticate',
      payload: { email, password },
    })
    assert.equal(oldPasswordLogin.statusCode, 401)

    const staleAccessRes = await app.inject({
      method: 'GET',
      url: '/users/me',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    assert.equal(staleAccessRes.statusCode, 401)
    assert.equal(staleAccessRes.json().message, 'Session invalidated')

    const { csrfToken, csrfCookieHeader } = await issueCsrfContext(app)
    const staleRefreshRes = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: {
        cookie: buildRefreshTokenCookieHeader(refreshToken, csrfCookieHeader),
        'x-csrf-token': csrfToken,
      },
    })
    assert.equal(staleRefreshRes.statusCode, 401)
    assert.equal(staleRefreshRes.json().message, 'Refresh token session invalidated')

    await app.flushAuditLogs()
    const confirmedLogs = await app.mongo.db
      .collection('auditLogs')
      .find({ action: 'auth_password_reset_confirmed', userId, resourceId: userId })
      .sort({ createdAt: 1 })
      .toArray()
    assert.equal(confirmedLogs.length, 1)
  })

  test('returns 400 when newPassword violates password policy', async (t) => {
    // Arrange
    const app = await buildApp(t)

    // Act
    const response = await app.inject({
      method: 'POST',
      url: '/auth/reset-password/confirm',
      payload: {
        resetId: randomUUIDv7(),
        secret: 'a'.repeat(64),
        newPassword: 'weak',
      },
    })

    // Assert
    assert.equal(response.statusCode, 400)
    assert.ok(response.json().message)
  })

  test('returns 401 and records validation failure audit when secret is invalid', async (t) => {
    // Arrange
    const { app, email, userId } = await setup(t, 'user')
    mailerPlugin.clearTestMessages()

    await app.inject({
      method: 'POST',
      url: '/auth/reset-password/request',
      payload: { email },
    })
    const { resetId, secret } = extractResetToken(mailerPlugin.getTestMessages()[0].text)
    const invalidSecret = invalidateTokenSecret(secret)

    // Act
    const response = await app.inject({
      method: 'POST',
      url: '/auth/reset-password/confirm',
      payload: {
        resetId,
        secret: invalidSecret,
        newPassword: randomPassword(16),
      },
    })

    // Assert
    assert.equal(response.statusCode, 401)
    assert.equal(response.json().message, 'Invalid or expired reset token')

    await app.flushAuditLogs()
    const failedLogs = await app.mongo.db
      .collection('auditLogs')
      .find({
        action: 'auth_password_reset_validation_failed',
        userId,
        resourceId: resetId,
        'details.phase': 'confirm',
        'details.reason': 'invalid_secret',
      })
      .sort({ createdAt: 1 })
      .toArray()
    assert.equal(failedLogs.length, 1)
    assert.equal(failedLogs[0].resourceType, 'password_reset')
  })

  test('returns 401 when reset token is expired', async (t) => {
    // Arrange
    const { app, email, userId } = await setup(t, 'user')
    mailerPlugin.clearTestMessages()

    await app.inject({
      method: 'POST',
      url: '/auth/reset-password/request',
      payload: { email },
    })
    const { resetId, secret } = extractResetToken(mailerPlugin.getTestMessages()[0].text)

    await app.mongo.db
      .collection('users')
      .updateOne(
        { _id: userId },
        { $set: { 'passwordReset.expiresAt': new Date('2020-01-01T00:00:00.000Z') } },
      )

    // Act
    const response = await app.inject({
      method: 'POST',
      url: '/auth/reset-password/confirm',
      payload: {
        resetId,
        secret,
        newPassword: randomPassword(16),
      },
    })

    // Assert
    assert.equal(response.statusCode, 401)
    assert.equal(response.json().message, 'Invalid or expired reset token')
  })

  test('returns 401 when attempting to reuse an already-consumed reset token', async (t) => {
    // Arrange
    const { app, email } = await setup(t, 'user')
    mailerPlugin.clearTestMessages()

    await app.inject({
      method: 'POST',
      url: '/auth/reset-password/request',
      payload: { email },
    })
    const { resetId, secret } = extractResetToken(mailerPlugin.getTestMessages()[0].text)

    const firstConfirm = await app.inject({
      method: 'POST',
      url: '/auth/reset-password/confirm',
      payload: { resetId, secret, newPassword: randomPassword(16) },
    })
    assert.equal(firstConfirm.statusCode, 200)

    // Act
    const secondConfirm = await app.inject({
      method: 'POST',
      url: '/auth/reset-password/confirm',
      payload: { resetId, secret, newPassword: randomPassword(18) },
    })

    // Assert
    assert.equal(secondConfirm.statusCode, 401)
    assert.equal(secondConfirm.json().message, 'Invalid or expired reset token')
  })
})
