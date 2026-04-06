'use strict'

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs/promises')
const path = require('node:path')
const {
  cryptoRandom,
  generateUUID,
  generateKey,
  crcToken,
  generateToken,
  validateToken,
  hashPassword,
  validatePassword,
  serializeHash,
  deserializeHash,
  md5,
} = require('../../utils/crypto')

test('cryptoRandom generates floats between 0 and 1', (t) => {
  const val = cryptoRandom()
  assert.ok(typeof val === 'number')
  assert.ok(val >= 0 && val < 1, 'Value should be between 0 and 1')

  // Ensure it doesn't just return the same number over and over again
  const val2 = cryptoRandom()
  assert.notStrictEqual(val, val2, 'Consecutive calls should be random')
})

test('generateUUID returns a valid v4 UUID', (t) => {
  const uuid = generateUUID()
  assert.strictEqual(typeof uuid, 'string')
  assert.strictEqual(uuid.length, 36)

  // Regex strictly enforces UUIDv4 standard (13th char is '4', 17th char is '8', '9', 'a', or 'b')
  const v4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  assert.match(uuid, v4Regex, 'UUID should strictly match v4 format')
})

test('generateKey generates string of correct length using only allowed characters', (t) => {
  const chars = 'ABC'
  const length = 10
  const key = generateKey(length, chars)

  assert.strictEqual(key.length, length)
  // Ensure every character in the generated key exists in 'chars' string
  const isOnlyAllowedChars = key.split('').every(char => chars.includes(char))
  assert.ok(isOnlyAllowedChars, 'Key contains invalid characters')
})

test('Token generation and validation lifecycle', (t) => {
  const secret = 'my-super-secret-key'
  const allowedChars = 'abcdefghijklmnopqrstuvwxyz'
  const tokenLength = 16

  const token = generateToken(secret, allowedChars, tokenLength)
  assert.strictEqual(token.length, tokenLength, 'Token should be exactly the requested length')

  const isValid = validateToken(secret, token)
  assert.strictEqual(isValid, true, 'Token should validate with correct secret')

  const isInvalidSecret = validateToken('wrong-secret', token)
  assert.strictEqual(isInvalidSecret, false, 'Token should fail with wrong secret')

  // Tampered token validation
  const tamperedToken = token.slice(0, 10) + 'X' + token.slice(11)
  const isInvalidTampered = validateToken(secret, tamperedToken)
  assert.strictEqual(isInvalidTampered, false, 'Tampered token should fail validation')

  // Edge cases
  assert.strictEqual(validateToken(secret, ''), false, 'Empty token should fail')
  assert.strictEqual(validateToken(secret, 'abc'), false, 'Too short token should fail')
})

test('crcToken generates correct length hex string', (t) => {
  const secret = 'my-secret'
  const key = 'my-key'
  const token = crcToken(secret, key)

  assert.strictEqual(typeof token, 'string')
  assert.strictEqual(token.length, 4, 'CRC token should be exactly 4 characters')
  assert.match(token, /^[0-9a-f]{4}$/, 'CRC token should be a valid hex string')
})

test('serializeHash formats the PHC string correctly', (t) => {
  const dummySalt = Buffer.from('somesalt')
  const dummyHash = Buffer.from('somehash')

  const serialized = serializeHash(dummyHash, dummySalt)

  assert.ok(serialized.startsWith('$scrypt$N=32768,r=8,p=1,maxmem=67108864,dkLen=32$'))
  assert.ok(serialized.includes(dummySalt.toString('base64').replace(/=/g, '')))
  assert.ok(serialized.includes(dummyHash.toString('base64').replace(/=/g, '')))
})

test('Password hashing and validation lifecycle', async (t) => {
  const password = 'my-secure-password!123'

  const serializedHash = await hashPassword(password)
  assert.strictEqual(typeof serializedHash, 'string')
  assert.ok(serializedHash.startsWith('$scrypt$'), 'Hash should start with correct PHC prefix')

  const isValid = await validatePassword(password, serializedHash)
  assert.strictEqual(isValid, true, 'Correct password should validate successfully')

  const isInvalid = await validatePassword('wrong-password', serializedHash)
  assert.strictEqual(isInvalid, false, 'Incorrect password should fail validation')
})

test('Hash serialization and deserialization formatting', (t) => {
  const badAlgorithmHash = '$argon2i$v=19$m=4096,t=3,p=1$c29tZXNhbHQ$c29tZWhhc2g'
  assert.throws(
    () => deserializeHash(badAlgorithmHash),
    /Unsupported hash algorithm/,
    'Should throw if algorithm is not scrypt'
  )
})

test('MD5 file hashing creates correct hash from streams', async (t) => {
  const tempFilePath = path.join(__dirname, 'test-temp-file.txt')
  const fileContent = 'hello world'
  const expectedMd5 = '5eb63bbbe01eeed093cb22bb8f5acdc3'

  try {
    await fs.writeFile(tempFilePath, fileContent)
    const fileHash = await md5(tempFilePath)
    assert.strictEqual(fileHash, expectedMd5, 'MD5 hash of file content should match known value')

  } finally {
    await fs.unlink(tempFilePath).catch(() => {})
  }
})