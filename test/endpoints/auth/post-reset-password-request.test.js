'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { setup } = require('../../utils/setup-user')
const mailerPlugin = require('../../../plugins/mailer')

const GENERIC_RESET_RESPONSE_MESSAGE =
  'If an account exists for that email, a password reset link has been sent.'

describe('POST /auth/reset-password/request', () => {
  test('returns 200 and dispatches reset email with fragment token for registered user', async (t) => {
    // Arrange
    const { app, email } = await setup(t, 'user')
    mailerPlugin.clearTestMessages()

    // Act
    const response = await app.inject({
      method: 'POST',
      url: '/auth/reset-password/request',
      payload: { email },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.equal(response.json().message, GENERIC_RESET_RESPONSE_MESSAGE)
    const messages = mailerPlugin.getTestMessages()
    assert.equal(messages.length, 1)
    assert.equal(messages[0].to, email.toLowerCase())
    assert.ok(messages[0].text.includes('/reset-password/confirm#token='))
    assert.ok(!messages[0].text.includes('/reset-password/confirm?token='))
  })

  test('returns 200 without sending email when email is unknown', async (t) => {
    // Arrange
    const { app } = await setup(t, 'user')
    mailerPlugin.clearTestMessages()

    // Act
    const response = await app.inject({
      method: 'POST',
      url: '/auth/reset-password/request',
      payload: { email: 'unknown_user_12345@example.com' },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.equal(response.json().message, GENERIC_RESET_RESPONSE_MESSAGE)
    assert.equal(mailerPlugin.getTestMessages().length, 0)
  })

  test('returns 200 and suppresses repeat mail while writing cooldown audit event', async (t) => {
    // Arrange
    const { app, email, userId } = await setup(t, 'user')
    mailerPlugin.clearTestMessages()
    const firstResponse = await app.inject({
      method: 'POST',
      url: '/auth/reset-password/request',
      payload: { email },
    })
    assert.equal(firstResponse.statusCode, 200)

    // Act
    const secondResponse = await app.inject({
      method: 'POST',
      url: '/auth/reset-password/request',
      payload: { email },
    })

    // Assert
    assert.equal(secondResponse.statusCode, 200)
    assert.equal(secondResponse.json().message, GENERIC_RESET_RESPONSE_MESSAGE)
    assert.equal(mailerPlugin.getTestMessages().length, 1)

    await app.flushAuditLogs()
    const requestedLogs = await app.mongo.db
      .collection('auditLogs')
      .find({ action: 'auth_password_reset_requested', userId })
      .sort({ createdAt: 1 })
      .toArray()
    const ignoredLogs = await app.mongo.db
      .collection('auditLogs')
      .find({
        action: 'auth_password_reset_request_ignored',
        userId,
        'details.reason': 'cooldown_active',
      })
      .sort({ createdAt: 1 })
      .toArray()
    assert.equal(requestedLogs.length, 1)
    assert.equal(ignoredLogs.length, 1)
  })

  test('returns 400 when email format is invalid or missing', async (t) => {
    // Arrange
    const { app } = await setup(t, 'user')

    // Act
    const invalidEmailRes = await app.inject({
      method: 'POST',
      url: '/auth/reset-password/request',
      payload: { email: 'not-an-email' },
    })
    const missingEmailRes = await app.inject({
      method: 'POST',
      url: '/auth/reset-password/request',
      payload: {},
    })

    // Assert
    assert.equal(invalidEmailRes.statusCode, 400)
    assert.ok(invalidEmailRes.json().message)
    assert.equal(missingEmailRes.statusCode, 400)
    assert.ok(missingEmailRes.json().message)
  })
})
