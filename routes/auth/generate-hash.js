'use strict'

const argon2 = require('argon2')

function resolveMaxConcurrency(value, fallback = 2) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : fallback
}

function resolveMaxQueue(value, fallback = 32) {
  if (value === undefined || value === null || value === '') {
    return fallback
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback
}

const DEFAULT_MAX_CONCURRENCY = resolveMaxConcurrency(process.env.ARGON2_MAX_CONCURRENCY, 2)
const DEFAULT_MAX_QUEUE = resolveMaxQueue(process.env.ARGON2_MAX_QUEUE, 32)

function createOverloadError() {
  const error = new Error('Authentication service is busy. Please try again shortly.')
  error.statusCode = 503
  return error
}

function createPasswordHasher({
  maxConcurrency = DEFAULT_MAX_CONCURRENCY,
  maxQueue = DEFAULT_MAX_QUEUE,
  argon2Impl = argon2,
} = {}) {
  const effectiveMaxConcurrency = resolveMaxConcurrency(maxConcurrency, DEFAULT_MAX_CONCURRENCY)
  const effectiveMaxQueue = resolveMaxQueue(maxQueue, DEFAULT_MAX_QUEUE)
  let activeCount = 0
  const waitQueue = []

  function releaseSlot() {
    activeCount -= 1
    if (waitQueue.length > 0 && activeCount < effectiveMaxConcurrency) {
      activeCount += 1
      const next = waitQueue.shift()
      next()
    }
  }

  async function runWithConcurrencyGate(task) {
    if (activeCount < effectiveMaxConcurrency) {
      activeCount += 1
    } else {
      if (waitQueue.length >= effectiveMaxQueue) {
        throw createOverloadError()
      }
      await new Promise((resolve) => {
        waitQueue.push(resolve)
      })
    }

    try {
      return await task()
    } finally {
      releaseSlot()
    }
  }

  const hashPassword = async (password) => {
    return runWithConcurrencyGate(async () => {
      try {
        return await argon2Impl.hash(password, {
          type: argon2Impl.argon2id,
          memoryCost: 65536,
          timeCost: 3,
          parallelism: 4,
        })
      } catch (err) {
        if (err.statusCode === 503) {
          throw err
        }
        throw new Error('Error hashing password: ' + err.message, { cause: err })
      }
    })
  }

  const validatePassword = async (password, hash) => {
    return runWithConcurrencyGate(async () => {
      return await argon2Impl.verify(hash, password)
    })
  }

  return {
    hashPassword,
    validatePassword,
  }
}

const defaultHasher = createPasswordHasher()

module.exports = {
  createPasswordHasher,
  hashPassword: defaultHasher.hashPassword,
  validatePassword: defaultHasher.validatePassword,
}
