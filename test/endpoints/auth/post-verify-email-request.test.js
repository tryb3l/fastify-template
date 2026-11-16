'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { randomEmail } = require('../../utils/data-creator')
const { seedUser, setup } = require('../../utils/setup-user')
const { extractEmailVerificationToken } = require('../../utils/auth-helpers')
const mailerPlugin = require('../../../plugins/mailer')

const EXPECTED_MESSAGE =
  'If an unverified account exists for that email, a verification link has been sent.'

describe('POST /auth/verify-email/request', () => {
  test('returns 200 and emails fragment verification link for authenticated unverified user', async (t) => {
    // Arrange
    const { app, accessToken, email } = await setup(t, 'user', { REGISTRATION_MODE: 'open' })
    mailerPlugin.clearTestMessages()

    // Act
    const response = await app.inject({
      method: 'POST',
      url: '/auth/verify-email/request',
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: {},
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.equal(response.json().message, EXPECTED_MESSAGE)
    const messages = mailerPlugin.getTestMessages()
    assert.equal(messages.length, 1)
    assert.equal(messages[0].to, email.toLowerCase())
    assert.ok(messages[0].text.includes('/verify-email/confirm#token='))
    assert.ok(!messages[0].text.includes('/verify-email/confirm?token='))
    assert.ok(extractEmailVerificationToken(messages[0].text))
  })

  test('returns 200 and dispatches verification link when email is passed in body', async (t) => {
    // Arrange
    const actor = await seedUser(t, { emailVerified: false })
    mailerPlugin.clearTestMessages()

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: '/auth/verify-email/request',
      payload: { email: actor.email.toUpperCase() },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.equal(response.json().message, EXPECTED_MESSAGE)
    const messages = mailerPlugin.getTestMessages()
    assert.equal(messages.length, 1)
    assert.equal(messages[0].to, actor.email)
  })

  test('returns 200 without sending email for unknown or already-verified account', async (t) => {
    // Arrange
    const actor = await seedUser(t, { emailVerified: true })
    mailerPlugin.clearTestMessages()

    // Act
    const verifiedResponse = await actor.app.inject({
      method: 'POST',
      url: '/auth/verify-email/request',
      payload: { email: actor.email },
    })
    const unknownResponse = await actor.app.inject({
      method: 'POST',
      url: '/auth/verify-email/request',
      payload: { email: randomEmail(10, 5) },
    })

    // Assert
    assert.equal(verifiedResponse.statusCode, 200)
    assert.equal(unknownResponse.statusCode, 200)
    assert.equal(verifiedResponse.json().message, EXPECTED_MESSAGE)
    assert.equal(unknownResponse.json().message, EXPECTED_MESSAGE)
    assert.equal(mailerPlugin.getTestMessages().length, 0)
  })

  test('returns 400 when neither email nor Authorization header is provided', async (t) => {
    // Arrange
    const actor = await seedUser(t, { emailVerified: false })

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: '/auth/verify-email/request',
      payload: {},
    })

    // Assert
    assert.equal(response.statusCode, 400)
    assert.ok(response.json().message)
  })

  test('returns 400 when email format in payload is invalid', async (t) => {
    // Arrange
    const actor = await seedUser(t, { emailVerified: false })

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: '/auth/verify-email/request',
      payload: { email: 'not-valid-email' },
    })

    // Assert
    assert.equal(response.statusCode, 400)
    assert.ok(response.json().message)
  })

  test('returns 401 when Authorization token without email is invalid', async (t) => {
    // Arrange
    const actor = await seedUser(t, { emailVerified: false })

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: '/auth/verify-email/request',
      headers: { Authorization: 'Bearer invalid.jwt.token' },
      payload: {},
    })

    // Assert
    assert.equal(response.statusCode, 401)
  })
})
