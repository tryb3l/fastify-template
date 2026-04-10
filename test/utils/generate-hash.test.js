'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { hashPassword, validatePassword } = require('../../routes/auth/generate-hash')

test('validatePassword returns true for matching password and hash', async () => {
  const password = 'correct-horse-battery-staple'
  const hash = await hashPassword(password)
  const result = await validatePassword(password, hash)
  assert.strictEqual(result, true)
})

test('validatePassword returns false for non-matching password', async () => {
  const hash = await hashPassword('original-password')
  const result = await validatePassword('wrong-password', hash)
  assert.strictEqual(result, false)
})

test('validatePassword rejects with an error for corrupt/invalid hash input', async () => {
  await assert.rejects(
    () => validatePassword('some-password', 'this-is-not-a-valid-argon2-hash'),
    (err) => {
      assert.ok(err instanceof Error, 'Should throw an Error instance')
      return true
    },
  )
})
