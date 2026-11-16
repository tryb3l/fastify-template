'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Fastify = require('fastify')

const { resolveHttpsOptions, resolveTrustProxy } = require('../../configs/server-options')
const migration008 = require('../../migrations/008-esr-flashcard-drill-index')
const cachePlugin = require('../../plugins/cache')
const configPlugin = require('../../plugins/config')
const { resolveMongoPoolOptions } = require('../../plugins/db')
const mailerPlugin = require('../../plugins/mailer')
const { resolveUnderPressureThresholds } = require('../../plugins/under-pressure')
const { buildApp, getTestEnv } = require('../test-setup')

function buildConfigData(env = {}) {
  return {
    MONGO_URL: 'mongodb://localhost:27017/test',
    NODE_ENV: 'test',
    JWT_SECRET: 'secret-11111111',
    COOKIE_SECRET: 'cookie-secret-11111111',
    FRONTEND_URL: 'http://localhost:5173',
    ...env,
  }
}

function withoutProcessEnv(t, keys) {
  const saved = keys.map((key) => ({
    key,
    hadKey: Object.prototype.hasOwnProperty.call(process.env, key),
    value: process.env[key],
  }))

  for (const { key } of saved) {
    delete process.env[key]
  }

  t.after(() => {
    for (const { key, hadKey, value } of saved) {
      if (hadKey) {
        process.env[key] = value
      } else {
        delete process.env[key]
      }
    }
  })
}

describe('Application configuration', () => {
  test('defaults development SMTP to local Mailpit when SMTP env is absent', async (t) => {
    // Arrange
    const app = Fastify({ logger: false })
    t.after(async () => {
      await app.close()
    })

    // Act
    await app.register(configPlugin, {
      configData: buildConfigData({ NODE_ENV: 'development' }),
    })

    // Assert
    assert.equal(app.config.mailer.smtp.host, '127.0.0.1')
    assert.equal(app.config.mailer.smtp.port, 1025)
    assert.equal(app.config.mailer.smtp.secure, false)
  })

  test('requires SMTP outside development and test', async (t) => {
    // Arrange
    const app = Fastify({ logger: false })
    t.after(async () => {
      await app.close().catch(() => {})
    })
    app.register(configPlugin, {
      configData: buildConfigData({ NODE_ENV: 'production' }),
    })
    app.register(mailerPlugin)

    // Act & Assert
    await assert.rejects(
      () => app.ready(),
      (err) => err.code === 'SMTP_CONFIG_REQUIRED',
    )
  })

  test('exposes calibrated memory, cache, quota, and registration defaults and respects overrides', async (t) => {
    // Arrange
    withoutProcessEnv(t, [
      'MAX_HEAP_USED_BYTES',
      'MAX_RSS_BYTES',
      'CACHE_MAX_ENTRIES',
      'REGISTRATION_MODE',
      'MAX_UPLOAD_BYTES',
      'USER_STORAGE_QUOTA_BYTES',
    ])
    const defaultApp = Fastify({ logger: false })
    const overrideApp = Fastify({ logger: false })
    t.after(async () => {
      await defaultApp.close()
      await overrideApp.close()
    })

    // Act
    await defaultApp.register(configPlugin, {
      configData: buildConfigData(),
    })
    await overrideApp.register(configPlugin, {
      configData: buildConfigData({
        MAX_HEAP_USED_BYTES: '800000000',
        MAX_RSS_BYTES: '1300000000',
        CACHE_MAX_ENTRIES: '500',
        REGISTRATION_MODE: 'open',
      }),
    })

    // Assert
    assert.equal(defaultApp.config.MAX_HEAP_USED_BYTES, 750_000_000)
    assert.equal(defaultApp.config.MAX_RSS_BYTES, 1_200_000_000)
    assert.equal(defaultApp.config.CACHE_MAX_ENTRIES, 2_000)
    assert.equal(defaultApp.config.REGISTRATION_MODE, 'invite')
    assert.equal(defaultApp.config.MAX_UPLOAD_BYTES, 10_000_000)
    assert.equal(defaultApp.config.USER_STORAGE_QUOTA_BYTES, 524_288_000)

    assert.equal(overrideApp.config.MAX_HEAP_USED_BYTES, 800_000_000)
    assert.equal(overrideApp.config.MAX_RSS_BYTES, 1_300_000_000)
    assert.equal(overrideApp.config.CACHE_MAX_ENTRIES, 500)
    assert.equal(overrideApp.config.REGISTRATION_MODE, 'open')
  })

  test('cache plugin enforces bounded LRU eviction and TTL expiration', async (t) => {
    // Arrange
    t.mock.timers.enable({ apis: ['Date'] })
    t.mock.timers.setTime(1_000_000)
    const app = Fastify({ logger: false })
    t.after(async () => {
      await app.close()
    })
    await app.register(configPlugin, {
      configData: buildConfigData({ CACHE_MAX_ENTRIES: '3' }),
    })
    await app.register(cachePlugin)

    // Act
    await app.cacheSet('note:1:u1', { id: '1' }, 60_000)
    await app.cacheSet('note:2:u1', { id: '2' }, 60_000)
    await app.cacheSet('note:3:u1', { id: '3' }, 60_000)
    const hit1 = await app.cacheGet('note:1:u1')
    await app.cacheSet('note:4:u1', { id: '4' }, 60_000)

    // Assert
    assert.deepEqual(hit1?.item, { id: '1' })
    assert.equal(typeof hit1?.stored, 'number')
    assert.equal(typeof hit1?.ttl, 'number')
    assert.equal(await app.cacheGet('note:2:u1'), null)
    assert.deepEqual((await app.cacheGet('note:1:u1'))?.item, { id: '1' })
    assert.deepEqual((await app.cacheGet('note:3:u1'))?.item, { id: '3' })
    assert.deepEqual((await app.cacheGet('note:4:u1'))?.item, { id: '4' })

    // Act & Assert: explicit delete and deterministic TTL expiration
    await app.cacheDelete('note:3:u1')
    assert.equal(await app.cacheGet('note:3:u1'), null)

    await app.cacheSet('note:short:u1', { id: 'short' }, 15)
    t.mock.timers.tick(20)
    assert.equal(await app.cacheGet('note:short:u1'), null)
  })

  test('.dockerignore excludes local TLS keys, uploads, git, node_modules, and runtime dirs', () => {
    // Arrange
    const dockerignorePath = path.join(__dirname, '..', '..', '.dockerignore')

    // Act
    const entries = fs
      .readFileSync(dockerignorePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'))

    // Assert
    for (const requiredPattern of [
      '.env',
      '.certs',
      'uploads',
      '.git',
      'node_modules',
      '.runtime',
      '.scratch',
    ]) {
      assert.ok(
        entries.includes(requiredPattern) || entries.includes(`${requiredPattern}/`),
        `Expected .dockerignore to exclude ${requiredPattern}`,
      )
    }
  })

  test('resolveHttpsOptions skips implicit .certs auto-loading in production by default', () => {
    // Arrange & Act
    const prodImplicit = resolveHttpsOptions({ NODE_ENV: 'production' })
    const disabled = resolveHttpsOptions({ NODE_ENV: 'development', HTTPS_ENABLED: 'false' })

    // Assert
    assert.equal(prodImplicit, null)
    assert.equal(disabled, null)
  })

  test('resolveTrustProxy defaults to false and supports boolean, hop-count, and CIDR list', async (t) => {
    // Arrange & Assert pure parsing
    assert.equal(resolveTrustProxy(undefined), false)
    assert.equal(resolveTrustProxy(''), false)
    assert.equal(resolveTrustProxy('false'), false)
    assert.equal(resolveTrustProxy('0'), false)
    assert.equal(resolveTrustProxy('true'), true)
    assert.equal(resolveTrustProxy('2'), 2)
    assert.equal(resolveTrustProxy('127.0.0.1'), '127.0.0.1')
    assert.deepEqual(resolveTrustProxy('127.0.0.1, 10.0.0.0/8'), ['127.0.0.1', '10.0.0.0/8'])

    const untrustedApp = Fastify({ logger: false, trustProxy: resolveTrustProxy(undefined) })
    untrustedApp.get('/ip', async (req) => ({ ip: req.ip }))
    t.after(async () => {
      await untrustedApp.close()
    })

    const trustedApp = Fastify({ logger: false, trustProxy: resolveTrustProxy('127.0.0.1') })
    trustedApp.get('/ip', async (req) => ({ ip: req.ip }))
    t.after(async () => {
      await trustedApp.close()
    })

    // Act
    const untrustedRes = await untrustedApp.inject({
      method: 'GET',
      url: '/ip',
      remoteAddress: '127.0.0.1',
      headers: { 'x-forwarded-for': '203.0.113.55' },
    })
    const trustedRes = await trustedApp.inject({
      method: 'GET',
      url: '/ip',
      remoteAddress: '127.0.0.1',
      headers: { 'x-forwarded-for': '203.0.113.55' },
    })

    // Assert
    assert.equal(untrustedRes.json().ip, '127.0.0.1')
    assert.equal(trustedRes.json().ip, '203.0.113.55')
  })

  test('does not populate a hardcoded default ADMIN_PASSWORD when unset', async (t) => {
    // Arrange
    withoutProcessEnv(t, ['ADMIN_PASSWORD'])
    const app = Fastify({ logger: false })
    t.after(async () => {
      await app.close()
    })

    // Act
    await app.register(configPlugin, { configData: buildConfigData() })

    // Assert
    assert.equal(app.config.ADMIN_PASSWORD, undefined)
  })

  test('exposes production MongoDB pool defaults (20/2) when test overrides are cleared and clamps min<=max', async (t) => {
    // Arrange
    withoutProcessEnv(t, ['MONGO_MAX_POOL_SIZE', 'MONGO_MIN_POOL_SIZE'])
    const defaultApp = Fastify({ logger: false })
    t.after(async () => {
      await defaultApp.close()
    })

    // Act
    await defaultApp.register(configPlugin, {
      configData: getTestEnv({
        MONGO_MAX_POOL_SIZE: undefined,
        MONGO_MIN_POOL_SIZE: undefined,
      }),
    })

    // Assert
    assert.equal(defaultApp.config.MONGO_MAX_POOL_SIZE, 20)
    assert.equal(defaultApp.config.MONGO_MIN_POOL_SIZE, 2)
    assert.deepEqual(resolveMongoPoolOptions(defaultApp.config), {
      maxPoolSize: 20,
      minPoolSize: 2,
    })
    assert.deepEqual(resolveMongoPoolOptions({ MONGO_MAX_POOL_SIZE: 8, MONGO_MIN_POOL_SIZE: 15 }), {
      maxPoolSize: 8,
      minPoolSize: 8,
    })
    assert.deepEqual(resolveMongoPoolOptions({ MONGO_MAX_POOL_SIZE: 0, MONGO_MIN_POOL_SIZE: -4 }), {
      maxPoolSize: 1,
      minPoolSize: 0,
    })
  })

  test('under-pressure calibrates default maxRssBytes above maxHeapUsedBytes and respects env overrides', async (t) => {
    // Arrange
    const defaults = resolveUnderPressureThresholds({})
    const overridden = resolveUnderPressureThresholds({
      MAX_HEAP_USED_BYTES: 600_000_000,
      MAX_RSS_BYTES: 1_100_000_000,
    })
    const app = await buildApp(t, {
      MAX_HEAP_USED_BYTES: '800000000',
      MAX_RSS_BYTES: '1300000000',
    })

    // Act
    const response = await app.inject({ method: 'GET', url: '/health' })

    // Assert
    assert.ok(defaults.maxRssBytes >= defaults.maxHeapUsedBytes + 350_000_000)
    assert.equal(overridden.maxHeapUsedBytes, 600_000_000)
    assert.equal(overridden.maxRssBytes, 1_100_000_000)
    assert.equal(response.statusCode, 200)
  })

  test('migration 008-esr-flashcard-drill-index creates and drops the ESR flashcard drill index', async () => {
    // Arrange
    const created = []
    const dropped = []
    const fakeDb = {
      collection(name) {
        assert.equal(name, 'flashcards')
        return {
          async createIndex(keys) {
            created.push(keys)
            return 'userId_1_noteId_1_box_1_nextReviewAt_1'
          },
          async dropIndex(indexName) {
            dropped.push(indexName)
          },
        }
      },
    }

    // Act
    await migration008.up(fakeDb)
    await migration008.down(fakeDb)

    // Assert
    assert.deepEqual(created, [{ userId: 1, noteId: 1, box: 1, nextReviewAt: 1 }])
    assert.deepEqual(dropped, ['userId_1_noteId_1_box_1_nextReviewAt_1'])
  })
})
