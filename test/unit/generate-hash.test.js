'use strict'

const test = require('node:test')
const assert = require('node:assert')
const {
  createPasswordHasher,
  hashPassword,
  validatePassword,
} = require('../../routes/auth/generate-hash')

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

test('password hasher bounds concurrent Argon2 operations and sheds overflow queue with 503', async () => {
  let activeCount = 0
  let maxObservedActive = 0
  const pendingResolvers = []

  const controlledHasher = createPasswordHasher({
    maxConcurrency: 2,
    maxQueue: 1,
    argon2Impl: {
      argon2id: 2,
      async hash(password) {
        activeCount += 1
        if (activeCount > maxObservedActive) {
          maxObservedActive = activeCount
        }
        await new Promise((resolve) => pendingResolvers.push(resolve))
        activeCount -= 1
        return `hashed:${password}`
      },
      async verify(hash, password) {
        activeCount += 1
        if (activeCount > maxObservedActive) {
          maxObservedActive = activeCount
        }
        await new Promise((resolve) => pendingResolvers.push(resolve))
        activeCount -= 1
        return hash === `hashed:${password}`
      },
    },
  })

  // Start 2 in-flight + 1 queued (hits capacity)
  const p1 = controlledHasher.hashPassword('pw-1')
  const p2 = controlledHasher.hashPassword('pw-2')
  const p3 = controlledHasher.validatePassword('pw-1', 'hashed:pw-1')

  // 4th concurrent call overflows maxQueue (1) and must shed with 503 immediately
  await assert.rejects(
    () => controlledHasher.hashPassword('pw-overflow'),
    (err) => {
      assert.strictEqual(err.statusCode, 503)
      return true
    },
  )

  assert.strictEqual(maxObservedActive, 2)

  // Release first two; queued 3rd starts and completes
  while (pendingResolvers.length > 0) {
    const resolve = pendingResolvers.shift()
    resolve()
    await new Promise((r) => setImmediate(r))
  }

  const [h1, h2, v3] = await Promise.all([p1, p2, p3])
  assert.strictEqual(h1, 'hashed:pw-1')
  assert.strictEqual(h2, 'hashed:pw-2')
  assert.strictEqual(v3, true)
  assert.strictEqual(maxObservedActive, 2)
})

test('password hasher falls back to safe finite defaults when maxConcurrency or maxQueue is invalid', async () => {
  const hasher = createPasswordHasher({
    maxConcurrency: 'invalid',
    maxQueue: 'not-a-number',
    argon2Impl: {
      argon2id: 2,
      async hash(password) {
        return `hashed:${password}`
      },
      async verify() {
        return true
      },
    },
  })

  assert.strictEqual(await hasher.hashPassword('p1'), 'hashed:p1')
})
