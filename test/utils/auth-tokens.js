'use strict'

const assert = require('node:assert/strict')

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

function flipFirstHexChar(secret) {
  const replacement = secret[0] === 'a' ? 'b' : 'a'
  return `${replacement}${secret.slice(1)}`
}

function extractEmailVerificationToken(messageText) {
  const match = messageText.match(/Verification token:\s*([0-9a-f-]+\.[0-9a-f]+)/i)
  assert.ok(match, 'Verification email should include token line')
  return match[1]
}

module.exports = {
  extractEmailVerificationToken,
  extractResetToken,
  flipFirstHexChar,
}
