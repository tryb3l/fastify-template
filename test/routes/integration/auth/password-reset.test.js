'use strict'

const test = require('node:test')
const assert = require('node:assert')
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

test('POST /auth/reset-password/request 200 - Triggers reset pipeline natively without leaking user existence', async (t) => {
  // Arrange
  const { app, email } = await setup(t, 'user')
  mailerPlugin.clearTestMessages()
  
  // Act
  const response = await app.inject({
    method: 'POST',
    url: '/auth/reset-password/request',
    payload: { email }
  })

  // Assert
  assert.strictEqual(response.statusCode, 200)
  assert.strictEqual(response.json().message, 'If an account exists for that email, a password reset link has been sent.')
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
    payload: { email: 'unknown_abcedfg12345@gmail.com' }
  })

  // Assert
  assert.strictEqual(response.statusCode, 200)
  assert.strictEqual(response.json().message, 'If an account exists for that email, a password reset link has been sent.')
  assert.strictEqual(mailerPlugin.getTestMessages().length, 0)
})

test('POST /auth/reset-password/validate 200 - Validates correct token', async (t) => {
  // Arrange
  const { app, email } = await setup(t, 'user')
  mailerPlugin.clearTestMessages()
  
  await app.inject({
    method: 'POST',
    url: '/auth/reset-password/request',
    payload: { email }
  })

  const messages = mailerPlugin.getTestMessages()
  assert.strictEqual(messages.length, 1)

  const { resetId, secret } = extractResetToken(messages[0].text)
  
  // Act
  const response = await app.inject({
    method: 'POST',
    url: '/auth/reset-password/validate',
    payload: { resetId, secret }
  })

  // Assert
  assert.strictEqual(response.statusCode, 200)
  assert.deepStrictEqual(response.json(), { valid: true })
})

test('POST /auth/reset-password/confirm 200 - Resets password and invalidates prior sessions', async (t) => {
  // Arrange
  const { app, email, password, accessToken, refreshToken } = await setup(t, 'user')
  const newPassword = randomPassword(16)
  mailerPlugin.clearTestMessages()

  const requestResponse = await app.inject({
    method: 'POST',
    url: '/auth/reset-password/request',
    payload: { email }
  })

  assert.strictEqual(requestResponse.statusCode, 200)

  const requestMessages = mailerPlugin.getTestMessages()
  assert.strictEqual(requestMessages.length, 1)

  const { resetId, secret } = extractResetToken(requestMessages[0].text)

  // Act
  const confirmResponse = await app.inject({
    method: 'POST',
    url: '/auth/reset-password/confirm',
    payload: { resetId, secret, newPassword }
  })

  // Assert
  assert.strictEqual(confirmResponse.statusCode, 200)
  assert.strictEqual(confirmResponse.json().message, 'Password has been successfully reset. You may now log in.')

  const oldPasswordLoginResponse = await app.inject({
    method: 'POST',
    url: '/auth/authenticate',
    payload: { email, password }
  })
  assert.strictEqual(oldPasswordLoginResponse.statusCode, 401)

  const newPasswordLoginResponse = await app.inject({
    method: 'POST',
    url: '/auth/authenticate',
    payload: { email, password: newPassword }
  })
  assert.strictEqual(newPasswordLoginResponse.statusCode, 200)

  const sessionResponse = await app.inject({
    method: 'GET',
    url: '/users/me',
    headers: { Authorization: `Bearer ${accessToken}` }
  })
  assert.strictEqual(sessionResponse.statusCode, 401)
  assert.strictEqual(sessionResponse.json().message, 'Session invalidated')

  const csrfResponse = await app.inject({
    method: 'GET',
    url: '/auth/csrf'
  })
  assert.strictEqual(csrfResponse.statusCode, 200)

  const csrfToken = csrfResponse.json().csrfToken
  const csrfCookie = csrfResponse.headers['set-cookie']
  const oldRefreshResponse = await app.inject({
    method: 'POST',
    url: '/auth/refresh',
    headers: {
      cookie: `refreshToken=${refreshToken}; ${Array.isArray(csrfCookie) ? csrfCookie[0] : csrfCookie}`,
      'x-csrf-token': csrfToken
    }
  })
  assert.strictEqual(oldRefreshResponse.statusCode, 401)
  assert.strictEqual(oldRefreshResponse.json().message, 'Refresh token session invalidated')
})
