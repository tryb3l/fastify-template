'use strict'

const { randomPrefetcher, generateUUID, generateToken } = require('../../utils/crypto')

// ==========================================
// VALID DATA GENERATORS
// ==========================================

function fastGenerate(length, chars) {
  const safeLength = Math.min(length, 1000000)
  let result = ''
  const charsLength = chars.length
  for (let i = 0; i < safeLength; i++) {
    result += chars.charAt(Math.floor(Math.random() * charsLength))
  }
  return result
}

function randomUsername(length = 8) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
  return fastGenerate(length, chars)
}

function randomEmail(usernameLength = 5, domainLength = 5) {
  const chars = 'abcdefghijklmnopqrstuvwxyz'
  return `${fastGenerate(usernameLength, chars)}@${fastGenerate(domainLength, chars)}.com`
}

function randomPassword(length = 12) {
  const lower = 'abcdefghijklmnopqrstuvwxyz'
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const digits = '0123456789'
  const special = '!@#$%^&*'
  const all = lower + upper + digits + special
  
  let result = fastGenerate(1, lower)
  result += fastGenerate(1, upper)
  result += fastGenerate(1, digits)
  result += fastGenerate(1, special)
  result += fastGenerate(length - 4, all)
  
  return result
}

function randomString(
  input = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
  length = 20,
) {
  const defaultSymbols = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const allowedSymbols = typeof input === 'string' ? input : defaultSymbols
  const finalLength = typeof input === 'number' ? input : length

  return fastGenerate(finalLength, allowedSymbols)
}

function randomStringWithPrefix(
  prefix = '',
  allowedSymbols = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
  length = 20,
) {
  const remainingLength = length - prefix.length
  if (remainingLength <= 0) return prefix.slice(0, length)

  return `${prefix}${fastGenerate(remainingLength, allowedSymbols)}`
}

// ==========================================
// BAD DATA GENERATORS
// ==========================================

function generateMathematicallyInvalidUUID() {
  const b1 = randomPrefetcher.next()
  const b2 = randomPrefetcher.next()
  const b3 = randomPrefetcher.next()
  const b4 = randomPrefetcher.next()

  // Not setting the v4 Version or Variant bits

  const h1 = b1.toString('hex')
  const h2 = b2.toString('hex')
  const h3 = b3.toString('hex')
  const h4 = b4.toString('hex')

  const d2 = h2.substring(0, 4)
  const d3 = h2.substring(4, 8)
  const d4 = h3.substring(0, 4)
  const d5 = h3.substring(4, 8) + h4

  return [h1, d2, d3, d4, d5].join('-')
}

function generateMalformedUUIDs() {
  const validUUID = generateUUID()
  return {
    tooShort: validUUID.slice(0, -1),
    tooLong: validUUID + 'a',
    invalidHexChar: validUUID.replace(/[a-f]/, 'Z'),
    missingDashes: validUUID.replace(/-/g, ''),
    wrongSeparators: validUUID.replace(/-/g, '_'),
    emptyString: ''
  }
}

function generateTamperedToken(secret) {
  const allowedChars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const validToken = generateToken(secret, allowedChars, 32)
  const tamperedChar = validToken[0] === 'a' ? 'b' : 'a'
  return tamperedChar + validToken.slice(1)
}

module.exports = {
  randomUsername,
  randomEmail,
  randomPassword,
  randomString,
  randomStringWithPrefix,
  generateMathematicallyInvalidUUID,
  generateMalformedUUIDs,
  generateTamperedToken
}