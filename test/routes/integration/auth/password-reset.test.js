'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { MongoClient } = require('mongodb')
const { setup } = require('../../../utils/setup-user')
const { randomPassword } = require('../../../utils/data-creator')
const mailerPlugin = require('../../../../plugins/mailer')

function extractResetToken(messageText) {
  const resetUrlMatch = messageText.match(/https?:\/\/\S+/)

  assert.ok(resetUrlMatch, 'Password reset email should contain a reset URL')

  const resetUrl = new URL(resetUrlMatch[0])
  const token = decodeURIComponent(resetUrl.hash.replace(/^#token=/, ''))
  const separatorIndex = token.indexOf('.')

  assert.ok(separatorIndex > 0, 'Password reset token should contain an id and secret')

  return {
    resetId: token.slice(0, separatorIndex),
    secret: token.slice(separatorIndex + 1),
  }
}

function buildInvalidSecret(secret) {
  const replacementCharacter = secret[0] === 'a' ? 'b' : 'a'
  return `${replacementCharacter}${secret.slice(1)}`
}

async function readAuditLogs(mongoUrl, filter) {
  const client = new MongoClient(mongoUrl)
  await client.connect()

  try {
    return await client.db().collection('auditLogs').find(filter).sort({ createdAt: 1 }).toArray()
  } finally {
    await client.close()
  }
}

async function waitForAuditLogs(mongoUrl, filter, minimumCount = 1) {
  const deadline = Date.now() + 1500

  while (Date.now() < deadline) {
    const logs = await readAuditLogs(mongoUrl, filter)
    if (logs.length >= minimumCount) {
      return logs
    }

    await new Promise((resolve) => setTimeout(resolve, 25))
  }

  return await readAuditLogs(mongoUrl, filter)
}

test('POST /auth/reset-password/request 200 - Triggers reset pipeline natively without leaking user existence', async (t) => {
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
  assert.strictEqual(response.statusCode, 200)
  assert.strictEqual(
    response.json().message,
    'If an account exists for that email, a password reset link has been sent.',
  )
  assert.strictEqual(mailerPlugin.getTestMessages().length, 1)
})

test('POST /auth/reset-password/request 200 - Also returns 200 for unknown emails gracefully', async (t) => {
  // Arrange
  const { app } = await setup(t, 'user') // Just to get app
  mailerPlugin.clearTestMessages()

  // Act
  const response = await app.inject({
    method: 'POST',
    url: '/auth/reset-password/request',
    payload: { email: 'unknown_abcedfg12345@gmail.com' },
  })

  // Assert
  assert.strictEqual(response.statusCode, 200)
  assert.strictEqual(
    response.json().message,
    'If an account exists for that email, a password reset link has been sent.',
  )
  assert.strictEqual(mailerPlugin.getTestMessages().length, 0)
})

test('POST /auth/reset-password/validate 200 - Validates correct token', async (t) => {
  // Arrange
  const { app, email } = await setup(t, 'user')
  mailerPlugin.clearTestMessages()

  await app.inject({
    method: 'POST',
    url: '/auth/reset-password/request',
    payload: { email },
  })

  const messages = mailerPlugin.getTestMessages()
  assert.strictEqual(messages.length, 1)

  const { resetId, secret } = extractResetToken(messages[0].text)

  // Act
  const response = await app.inject({
    method: 'POST',
    url: '/auth/reset-password/validate',
    payload: { resetId, secret },
  })

  // Assert
  assert.strictEqual(response.statusCode, 200)
  assert.deepStrictEqual(response.json(), { valid: true })
})

test('POST /auth/reset-password/validate 401 - Rejects expired tokens', async (t) => {
  // Arrange
  const { app, email, userId, mongoUrl } = await setup(t, 'user')
  mailerPlugin.clearTestMessages()

  await app.inject({
    method: 'POST',
    url: '/auth/reset-password/request',
    payload: { email },
  })

  const messages = mailerPlugin.getTestMessages()
  assert.strictEqual(messages.length, 1)

  const { resetId, secret } = extractResetToken(messages[0].text)

  const client = new MongoClient(mongoUrl.replace(/\/test$/, ''))

  await client.connect()

  try {
    await client
      .db()
      .collection('users')
      .updateOne(
        { _id: userId },
        { $set: { 'passwordReset.expiresAt': new Date('2020-01-01T00:00:00.000Z') } },
      )
  } finally {
    await client.close()
  }

  // Act
  const response = await app.inject({
    method: 'POST',
    url: '/auth/reset-password/validate',
    payload: { resetId, secret },
  })

  // Assert
  assert.strictEqual(response.statusCode, 401)
  assert.strictEqual(response.json().message, 'Invalid or expired reset token')
})

test('POST /auth/reset-password/confirm 200 - Resets password and invalidates prior sessions', async (t) => {
  // Arrange
  const { app, email, password, accessToken, refreshToken } = await setup(t, 'user')
  const newPassword = randomPassword(16)
  mailerPlugin.clearTestMessages()

  const requestResponse = await app.inject({
    method: 'POST',
    url: '/auth/reset-password/request',
    payload: { email },
  })

  assert.strictEqual(requestResponse.statusCode, 200)

  const requestMessages = mailerPlugin.getTestMessages()
  assert.strictEqual(requestMessages.length, 1)

  const { resetId, secret } = extractResetToken(requestMessages[0].text)

  // Act
  const confirmResponse = await app.inject({
    method: 'POST',
    url: '/auth/reset-password/confirm',
    payload: { resetId, secret, newPassword },
  })

  // Assert
  assert.strictEqual(confirmResponse.statusCode, 200)
  assert.strictEqual(
    confirmResponse.json().message,
    'Password has been successfully reset. You may now log in.',
  )

  const oldPasswordLoginResponse = await app.inject({
    method: 'POST',
    url: '/auth/authenticate',
    payload: { email, password },
  })
  assert.strictEqual(oldPasswordLoginResponse.statusCode, 401)

  const newPasswordLoginResponse = await app.inject({
    method: 'POST',
    url: '/auth/authenticate',
    payload: { email, password: newPassword },
  })
  assert.strictEqual(newPasswordLoginResponse.statusCode, 200)

  const sessionResponse = await app.inject({
    method: 'GET',
    url: '/users/me',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  assert.strictEqual(sessionResponse.statusCode, 401)
  assert.strictEqual(sessionResponse.json().message, 'Session invalidated')

  const csrfResponse = await app.inject({
    method: 'GET',
    url: '/auth/csrf',
  })
  assert.strictEqual(csrfResponse.statusCode, 200)

  const csrfToken = csrfResponse.json().csrfToken
  const csrfCookie = csrfResponse.headers['set-cookie']
  const oldRefreshResponse = await app.inject({
    method: 'POST',
    url: '/auth/refresh',
    headers: {
      cookie: `refreshToken=${refreshToken}; ${Array.isArray(csrfCookie) ? csrfCookie[0] : csrfCookie}`,
      'x-csrf-token': csrfToken,
    },
  })
  assert.strictEqual(oldRefreshResponse.statusCode, 401)
  assert.strictEqual(oldRefreshResponse.json().message, 'Refresh token session invalidated')
})

test('POST /auth/reset-password/request 200 - Suppresses repeat requests during cooldown and audits the ignore', async (t) => {
  // Arrange
  const { app, email, userId, mongoUrl } = await setup(t, 'user')
  mailerPlugin.clearTestMessages()

  // Act
  const firstResponse = await app.inject({
    method: 'POST',
    url: '/auth/reset-password/request',
    payload: { email },
  })

  const secondResponse = await app.inject({
    method: 'POST',
    url: '/auth/reset-password/request',
    payload: { email },
  })

  // Assert
  assert.strictEqual(firstResponse.statusCode, 200)
  assert.strictEqual(secondResponse.statusCode, 200)
  assert.strictEqual(mailerPlugin.getTestMessages().length, 1)

  const requestedLogs = await waitForAuditLogs(
    mongoUrl,
    { action: 'auth_password_reset_requested', userId },
    1,
  )
  const ignoredLogs = await waitForAuditLogs(
    mongoUrl,
    {
      action: 'auth_password_reset_request_ignored',
      userId,
      'details.reason': 'cooldown_active',
    },
    1,
  )

  assert.strictEqual(requestedLogs.length, 1)
  assert.strictEqual(ignoredLogs.length, 1)
})

test('POST /auth/reset-password/validate 401 - Locks the token after repeated invalid attempts', async (t) => {
  // Arrange
  const { app, email } = await setup(t, 'user', {
    PASSWORD_RESET_MAX_ATTEMPTS: 2,
  })
  mailerPlugin.clearTestMessages()

  await app.inject({
    method: 'POST',
    url: '/auth/reset-password/request',
    payload: { email },
  })

  const messages = mailerPlugin.getTestMessages()
  assert.strictEqual(messages.length, 1)

  const { resetId, secret } = extractResetToken(messages[0].text)
  const invalidSecret = buildInvalidSecret(secret)

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const invalidResponse = await app.inject({
      method: 'POST',
      url: '/auth/reset-password/validate',
      payload: { resetId, secret: invalidSecret },
    })

    assert.strictEqual(invalidResponse.statusCode, 401)
  }

  // Act
  const lockedResponse = await app.inject({
    method: 'POST',
    url: '/auth/reset-password/validate',
    payload: { resetId, secret },
  })

  // Assert
  assert.strictEqual(lockedResponse.statusCode, 401)
  assert.strictEqual(lockedResponse.json().message, 'Invalid or expired reset token')
})

test('POST /auth/reset-password/confirm 401 - Rejects reused token after a successful reset', async (t) => {
  // Arrange
  const { app, email } = await setup(t, 'user')
  const firstPassword = randomPassword(16)
  const secondPassword = randomPassword(18)
  mailerPlugin.clearTestMessages()

  await app.inject({
    method: 'POST',
    url: '/auth/reset-password/request',
    payload: { email },
  })

  const messages = mailerPlugin.getTestMessages()
  assert.strictEqual(messages.length, 1)

  const { resetId, secret } = extractResetToken(messages[0].text)

  const firstConfirmResponse = await app.inject({
    method: 'POST',
    url: '/auth/reset-password/confirm',
    payload: { resetId, secret, newPassword: firstPassword },
  })

  assert.strictEqual(firstConfirmResponse.statusCode, 200)

  // Act
  const secondConfirmResponse = await app.inject({
    method: 'POST',
    url: '/auth/reset-password/confirm',
    payload: { resetId, secret, newPassword: secondPassword },
  })

  // Assert
  assert.strictEqual(secondConfirmResponse.statusCode, 401)
  assert.strictEqual(secondConfirmResponse.json().message, 'Invalid or expired reset token')
})

test('Password reset audit trail - Writes request, invalid confirm, and confirm success events', async (t) => {
  // Arrange
  const { app, email, userId, mongoUrl } = await setup(t, 'user')
  const newPassword = randomPassword(16)
  mailerPlugin.clearTestMessages()

  const requestResponse = await app.inject({
    method: 'POST',
    url: '/auth/reset-password/request',
    payload: { email },
  })

  assert.strictEqual(requestResponse.statusCode, 200)

  const requestMessages = mailerPlugin.getTestMessages()
  assert.strictEqual(requestMessages.length, 1)

  const { resetId, secret } = extractResetToken(requestMessages[0].text)
  const invalidSecret = buildInvalidSecret(secret)

  const invalidConfirmResponse = await app.inject({
    method: 'POST',
    url: '/auth/reset-password/confirm',
    payload: { resetId, secret: invalidSecret, newPassword },
  })

  assert.strictEqual(invalidConfirmResponse.statusCode, 401)

  // Act
  const confirmResponse = await app.inject({
    method: 'POST',
    url: '/auth/reset-password/confirm',
    payload: { resetId, secret, newPassword },
  })

  // Assert
  assert.strictEqual(confirmResponse.statusCode, 200)

  const requestedLogs = await waitForAuditLogs(
    mongoUrl,
    {
      action: 'auth_password_reset_requested',
      userId,
      resourceId: userId,
    },
    1,
  )
  const invalidConfirmLogs = await waitForAuditLogs(
    mongoUrl,
    {
      action: 'auth_password_reset_validation_failed',
      resourceId: resetId,
      'details.phase': 'confirm',
      'details.reason': 'invalid_secret',
    },
    1,
  )
  const confirmedLogs = await waitForAuditLogs(
    mongoUrl,
    {
      action: 'auth_password_reset_confirmed',
      userId,
      resourceId: userId,
    },
    1,
  )

  assert.strictEqual(requestedLogs.length, 1)
  assert.strictEqual(invalidConfirmLogs.length, 1)
  assert.strictEqual(confirmedLogs.length, 1)
  assert.strictEqual(invalidConfirmLogs[0].resourceType, 'password_reset')
  assert.strictEqual(invalidConfirmLogs[0].details.phase, 'confirm')
})
