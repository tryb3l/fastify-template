'use strict'

const { generateKey } = require('../../utils/crypto')

function randomUsername(usernamelength = 8) {
  return generateKey(usernamelength, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ')
}

function randomEmail(usernameLength = 5, domainLength = 5) {
  return `${generateKey(usernameLength, 'abcdefghijklmnopqrstuvwxyz')}@${generateKey(domainLength, 'abcdefghijklmnopqrstuvwxyz')}.com`
}

function randomPassword(length = 12) {
  return generateKey(length, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')
}

function randomString(
  input = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
  length = 20,
) {
  const defaultSymbols = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const allowedSymbols = typeof input === 'string' ? input : defaultSymbols
  const finalLength = typeof input === 'number' ? input : length

  return generateKey(finalLength, allowedSymbols)
}

function randomStringWithPrefix(
  prefix = '',
  allowedSymbols = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
  length = 20,
) {
  return `${prefix}${generateKey(length, allowedSymbols)}`.slice(0, length)
}

module.exports = {
  randomUsername,
  randomEmail,
  randomPassword,
  randomString,
  randomStringWithPrefix,
}
