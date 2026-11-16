'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUIDv7 } = require('node:crypto')
const { buildApp } = require('../../test-setup')
const { setup } = require('../../utils/setup-user')
const { extractResetToken, invalidateTokenSecret } = require('../../utils/auth-tokens')
const mailerPlugin = require('../../../plugins/mailer')

describe('POST /auth/reset-password/validate', () => {
  test('returns 200 valid: true for a freshly issued reset token', async (t) => {
    // Arrange
    const { app, email } = await setup(t, 'user')
    mailerPlugin.clearTestMessages()

    const reqRes = await app.inject({
      method: 'POST',
      url: '/auth/reset-password/request',
      payload: { email },
    })
    assert.equal(reqRes.statusCode, 200)

    const messages = mailerPlugin.getTestMessages()
    assert.equal(messages.length, 1)
    const { resetId, secret } = extractResetToken(messages[0].text)

    // Act
    const response = await app.inject({
      method: 'POST',
      url: '/auth/reset-password/validate',
      payload: { resetId, secret },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.deepEqual(response.json(), { valid: true })
  })

  test('returns 400 when resetId is not a valid UUID', async (t) => {
    // Arrange
    const app = await buildApp(t)

    // Act
    const response = await app.inject({
      method: 'POST',
      url: '/auth/reset-password/validate',
      payload: { resetId: 'not-a-uuid', secret: 'a'.repeat(64) },
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 400 when secret is shorter than minimum length', async (t) => {
    // Arrange
    const app = await buildApp(t)

    // Act
    const response = await app.inject({
      method: 'POST',
      url: '/auth/reset-password/validate',
      payload: { resetId: randomUUIDv7(), secret: 'short' },
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 401 when reset token secret is invalid', async (t) => {
    // Arrange
    const { app, email } = await setup(t, 'user')
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
      url: '/auth/reset-password/validate',
      payload: { resetId, secret: invalidSecret },
    })

    // Assert
    assert.equal(response.statusCode, 401)
    assert.equal(response.json().message, 'Invalid or expired reset token')
  })

  test('returns 401 when resetId is unknown', async (t) => {
    // Arrange
    const app = await buildApp(t)

    // Act
    const response = await app.inject({
      method: 'POST',
      url: '/auth/reset-password/validate',
      payload: { resetId: randomUUIDv7(), secret: 'a'.repeat(64) },
    })

    // Assert
    assert.equal(response.statusCode, 401)
    assert.equal(response.json().message, 'Invalid or expired reset token')
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
      url: '/auth/reset-password/validate',
      payload: { resetId, secret },
    })

    // Assert
    assert.equal(response.statusCode, 401)
    assert.equal(response.json().message, 'Invalid or expired reset token')
  })

  test('returns 401 and locks token after repeated invalid secret attempts', async (t) => {
    // Arrange
    const { app, email } = await setup(t, 'user', { PASSWORD_RESET_MAX_ATTEMPTS: 2 })
    mailerPlugin.clearTestMessages()

    await app.inject({
      method: 'POST',
      url: '/auth/reset-password/request',
      payload: { email },
    })
    const { resetId, secret } = extractResetToken(mailerPlugin.getTestMessages()[0].text)
    const invalidSecret = invalidateTokenSecret(secret)

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const failedAttempt = await app.inject({
        method: 'POST',
        url: '/auth/reset-password/validate',
        payload: { resetId, secret: invalidSecret },
      })
      assert.equal(failedAttempt.statusCode, 401)
    }

    // Act
    const response = await app.inject({
      method: 'POST',
      url: '/auth/reset-password/validate',
      payload: { resetId, secret },
    })

    // Assert
    assert.equal(response.statusCode, 401)
    assert.equal(response.json().message, 'Invalid or expired reset token')
  })
})
