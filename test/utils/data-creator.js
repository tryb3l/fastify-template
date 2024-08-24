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

module.exports = {
  randomUsername,
  randomEmail,
  randomPassword,
}
