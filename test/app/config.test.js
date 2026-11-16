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
const usersPlugin = require('../../plugins/users')
const { buildApp, getTestEnv } = require('../test-setup')
const { seedUser } = require('../utils/setup-user')

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
    assert.equal(getTestEnv().CACHE_MAX_ENTRIES, '64')
    assert.equal(getTestEnv({ CACHE_MAX_ENTRIES: undefined }).CACHE_MAX_ENTRIES, undefined)
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

  test('cache plugin enforces bounded LRU eviction, user-vs-entity partition isolation, and monotonic TTL expiration', async (t) => {
    // Arrange
    let nowMs = 1_000_000
    const clock = {
      now() {
        return nowMs
      },
    }
    const app = Fastify({ logger: false })
    t.after(async () => {
      await app.close()
    })
    await app.register(configPlugin, {
      configData: buildConfigData({ CACHE_MAX_ENTRIES: '3' }),
    })
    await app.register(cachePlugin, {
      perf: clock,
      ttlResolution: 0,
    })

    // Act: populate user session keys and churn entity keys past CACHE_MAX_ENTRIES
    app.cacheSet('user:u1', { id: 'u1', role: 'member' }, 60_000)
    app.cacheSet('user:u2', { id: 'u2', role: 'admin' }, 60_000)
    app.cacheSet('note:1:u1', { id: '1' }, 60_000)
    app.cacheSet('note:2:u1', { id: '2' }, 60_000)
    app.cacheSet('note:3:u1', { id: '3' }, 60_000)
    const hit1 = app.cacheGet('note:1:u1')
    app.cacheSet('note:4:u1', { id: '4' }, 60_000)

    // Assert: raw values returned without wrapper metadata, note:2 evicted, user:* sessions untouched
    assert.deepEqual(hit1, { id: '1' })
    assert.equal(app.cacheGet('note:2:u1'), null)
    assert.deepEqual(app.cacheGet('note:1:u1'), { id: '1' })
    assert.deepEqual(app.cacheGet('note:3:u1'), { id: '3' })
    assert.deepEqual(app.cacheGet('note:4:u1'), { id: '4' })
    assert.deepEqual(app.cacheGet('user:u1'), { id: 'u1', role: 'member' })
    assert.deepEqual(app.cacheGet('user:u2'), { id: 'u2', role: 'admin' })

    // Act & Assert: explicit delete and deterministic monotonic TTL expiration
    app.cacheDelete('note:3:u1')
    assert.equal(app.cacheGet('note:3:u1'), null)

    app.cacheSet('note:short:u1', { id: 'short' }, 15)
    nowMs += 20
    assert.equal(app.cacheGet('note:short:u1'), null)
  })

  test('authenticated user-session lookups coalesce cold reads and prevent stale writes on concurrent invalidation', async (t) => {
    // Arrange: real HTTP app for parallel cold-session burst + gated store for mid-flight invalidation race
    const actor = await seedUser(t)
    const httpApp = actor.app
    const authHeaders = { authorization: `Bearer ${actor.accessToken}` }
    httpApp.cacheDelete(`user:${actor.userId}`)

    let findOneCalls = 0
    let releaseLookup
    const lookupGate = new Promise((resolve) => {
      releaseLookup = resolve
    })
    const fp = require('fastify-plugin')
    const gatedApp = Fastify({ logger: false })
    t.after(async () => {
      await gatedApp.close()
    })
    await gatedApp.register(configPlugin, {
      configData: buildConfigData({ CACHE_MAX_ENTRIES: '8' }),
    })
    await gatedApp.register(cachePlugin)
    await gatedApp.register(
      fp(
        async (instance) => {
          instance.decorate('mongo', {
            db: {
              collection(name) {
                if (name !== 'users') {
                  return {}
                }
                return {
                  async findOne(filter) {
                    findOneCalls += 1
                    await lookupGate
                    if (filter._id === 'missing-user') {
                      return null
                    }
                    return {
                      _id: filter._id,
                      username: 'alice',
                      email: 'alice@example.com',
                      role: 'member',
                      credentialsVersion: 1,
                    }
                  },
                }
              },
            },
          })
        },
        { name: 'db-plugin' },
      ),
    )
    await gatedApp.register(usersPlugin)
    await gatedApp.ready()

    // Act 1: parallel cold HTTP requests populate and share user:<id> cache entry
    const [me1, me2, me3] = await Promise.all([
      httpApp.inject({ method: 'GET', url: '/users/me', headers: authHeaders }),
      httpApp.inject({ method: 'GET', url: '/users/me', headers: authHeaders }),
      httpApp.inject({ method: 'GET', url: '/users/me', headers: authHeaders }),
    ])

    // Act 2: coalesced cold readUserById + mid-flight cacheDelete race
    const coldReadA = gatedApp.usersDataSource.readUserById('u-coalesced')
    const coldReadB = gatedApp.usersDataSource.readUserById('u-coalesced')
    releaseLookup()
    const [resolvedA, resolvedB] = await Promise.all([coldReadA, coldReadB])

    let releaseRaceLookup
    lookupGate.then(() => {})
    let raceFindCalls = 0
    const raceApp = Fastify({ logger: false })
    t.after(async () => {
      await raceApp.close()
    })
    const raceGate = new Promise((resolve) => {
      releaseRaceLookup = resolve
    })
    await raceApp.register(configPlugin, {
      configData: buildConfigData({ CACHE_MAX_ENTRIES: '8' }),
    })
    await raceApp.register(cachePlugin)
    await raceApp.register(
      fp(
        async (instance) => {
          instance.decorate('mongo', {
            db: {
              collection() {
                return {
                  async findOne(filter) {
                    raceFindCalls += 1
                    await raceGate
                    return {
                      _id: filter._id,
                      username: 'bob',
                      email: 'bob@example.com',
                      role: 'member',
                      credentialsVersion: 1,
                    }
                  },
                }
              },
            },
          })
        },
        { name: 'db-plugin' },
      ),
    )
    await raceApp.register(usersPlugin)
    await raceApp.ready()

    const inFlightUserRead = raceApp.usersDataSource.readUserById('u-race')
    raceApp.cacheDelete('user:u-race')
    releaseRaceLookup()
    const inFlightResult = await inFlightUserRead

    // Assert
    assert.equal(me1.statusCode, 200)
    assert.equal(me2.statusCode, 200)
    assert.equal(me3.statusCode, 200)
    assert.equal(httpApp.cacheGet(`user:${actor.userId}`)?.id, actor.userId)
    assert.equal(findOneCalls, 1)
    assert.equal(resolvedA.id, 'u-coalesced')
    assert.equal(resolvedB.id, 'u-coalesced')
    assert.equal(gatedApp.cacheGet('user:u-coalesced')?.id, 'u-coalesced')
    assert.equal(raceFindCalls, 1)
    assert.equal(inFlightResult.id, 'u-race')
    assert.equal(raceApp.cacheGet('user:u-race'), null)
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
