'use strict'

const test = require('node:test')
const assert = require('node:assert')
const Fastify = require('fastify')
const configPlugin = require('../../plugins/config')
const mailerPlugin = require('../../plugins/mailer')

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

test('application-config defaults development SMTP to local Mailpit when SMTP env is absent', async (t) => {
  const app = Fastify({ logger: false })

  t.after(async () => {
    await app.close()
  })

  await app.register(configPlugin, {
    configData: buildConfigData({ NODE_ENV: 'development' }),
  })

  assert.strictEqual(app.config.mailer.smtp.host, '127.0.0.1')
  assert.strictEqual(app.config.mailer.smtp.port, 1025)
  assert.strictEqual(app.config.mailer.smtp.secure, false)
})

test('mailer plugin requires SMTP outside development and test', async (t) => {
  const app = Fastify({ logger: false })

  t.after(async () => {
    await app.close().catch(() => {})
  })

  app.register(configPlugin, {
    configData: buildConfigData({ NODE_ENV: 'production' }),
  })
  app.register(mailerPlugin)

  await assert.rejects(
    () => app.ready(),
    (err) => err.code === 'SMTP_CONFIG_REQUIRED',
  )
})

test('application-config exposes calibrated memory and cache ceiling defaults and respects env overrides', async (t) => {
  const app = Fastify({ logger: false })

  t.after(async () => {
    await app.close()
  })

  await app.register(configPlugin, {
    configData: buildConfigData({
      MAX_HEAP_USED_BYTES: '800000000',
      MAX_RSS_BYTES: '1300000000',
      CACHE_MAX_ENTRIES: '500',
    }),
  })

  assert.strictEqual(app.config.MAX_HEAP_USED_BYTES, 800_000_000)
  assert.strictEqual(app.config.MAX_RSS_BYTES, 1_300_000_000)
  assert.strictEqual(app.config.CACHE_MAX_ENTRIES, 500)
})

test('cache plugin enforces bounded LRU eviction and TTL expiration while preserving cacheGet/cacheSet/cacheDelete contract', async (t) => {
  const cachePlugin = require('../../plugins/cache')
  const app = Fastify({ logger: false })

  t.after(async () => {
    await app.close()
  })

  await app.register(configPlugin, {
    configData: buildConfigData({
      CACHE_MAX_ENTRIES: '3',
    }),
  })
  await app.register(cachePlugin)

  await app.cacheSet('note:1:u1', { id: '1' }, 60_000)
  await app.cacheSet('note:2:u1', { id: '2' }, 60_000)
  await app.cacheSet('note:3:u1', { id: '3' }, 60_000)

  // Touch note:1:u1 so note:2:u1 becomes the least-recently-used entry
  const hit1 = await app.cacheGet('note:1:u1')
  assert.deepStrictEqual(hit1?.item, { id: '1' })
  assert.strictEqual(typeof hit1?.stored, 'number')
  assert.strictEqual(typeof hit1?.ttl, 'number')

  // Inserting a 4th entry must evict note:2:u1 (LRU) while keeping note:1:u1, note:3:u1, note:4:u1
  await app.cacheSet('note:4:u1', { id: '4' }, 60_000)

  assert.strictEqual(await app.cacheGet('note:2:u1'), null)
  assert.deepStrictEqual((await app.cacheGet('note:1:u1'))?.item, { id: '1' })
  assert.deepStrictEqual((await app.cacheGet('note:3:u1'))?.item, { id: '3' })
  assert.deepStrictEqual((await app.cacheGet('note:4:u1'))?.item, { id: '4' })

  // Explicit delete removes entry
  await app.cacheDelete('note:3:u1')
  assert.strictEqual(await app.cacheGet('note:3:u1'), null)

  // Short TTL expires cleanly
  await app.cacheSet('note:short:u1', { id: 'short' }, 15)
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.strictEqual(await app.cacheGet('note:short:u1'), null)
})

test('.dockerignore excludes local TLS keys (.certs), uploads, .git, node_modules, and runtime/scratch directories', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const dockerignorePath = path.join(__dirname, '..', '..', '.dockerignore')
  const entries = fs
    .readFileSync(dockerignorePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))

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

test('resolveHttpsOptions skips implicit .certs auto-loading in production unless HTTPS_ENABLED=true or explicit paths are set', () => {
  const { resolveHttpsOptions } = require('../../configs/server-options')

  assert.strictEqual(typeof resolveHttpsOptions, 'function')

  // In production without HTTPS_ENABLED=true or explicit cert paths, must not auto-load .certs/localhost-key.pem
  const prodImplicit = resolveHttpsOptions({
    NODE_ENV: 'production',
  })
  assert.strictEqual(prodImplicit, null)

  // Explicit HTTPS_ENABLED=false always returns null
  const disabled = resolveHttpsOptions({
    NODE_ENV: 'development',
    HTTPS_ENABLED: 'false',
  })
  assert.strictEqual(disabled, null)
})

test('resolveTrustProxy defaults to false and supports boolean, hop-count integer, and CIDR list', async (t) => {
  const { resolveTrustProxy } = require('../../configs/server-options')

  assert.strictEqual(typeof resolveTrustProxy, 'function')
  assert.strictEqual(resolveTrustProxy(undefined), false)
  assert.strictEqual(resolveTrustProxy(''), false)
  assert.strictEqual(resolveTrustProxy('false'), false)
  assert.strictEqual(resolveTrustProxy('0'), false)
  assert.strictEqual(resolveTrustProxy('true'), true)
  assert.strictEqual(resolveTrustProxy('2'), 2)
  assert.strictEqual(resolveTrustProxy('127.0.0.1'), '127.0.0.1')
  assert.deepStrictEqual(resolveTrustProxy('127.0.0.1, 10.0.0.0/8'), ['127.0.0.1', '10.0.0.0/8'])

  // Untrusted proxy (default false) ignores X-Forwarded-For
  const untrustedApp = Fastify({ logger: false, trustProxy: resolveTrustProxy(undefined) })
  untrustedApp.get('/ip', async (req) => ({ ip: req.ip }))
  t.after(async () => {
    await untrustedApp.close()
  })
  const untrustedRes = await untrustedApp.inject({
    method: 'GET',
    url: '/ip',
    remoteAddress: '127.0.0.1',
    headers: { 'x-forwarded-for': '203.0.113.55' },
  })
  assert.strictEqual(untrustedRes.json().ip, '127.0.0.1')

  // Trusted loopback proxy resolves X-Forwarded-For client IP
  const trustedApp = Fastify({ logger: false, trustProxy: resolveTrustProxy('127.0.0.1') })
  trustedApp.get('/ip', async (req) => ({ ip: req.ip }))
  t.after(async () => {
    await trustedApp.close()
  })
  const trustedRes = await trustedApp.inject({
    method: 'GET',
    url: '/ip',
    remoteAddress: '127.0.0.1',
    headers: { 'x-forwarded-for': '203.0.113.55' },
  })
  assert.strictEqual(trustedRes.json().ip, '203.0.113.55')
})

test('application-config does not populate a hardcoded default ADMIN_PASSWORD when unset', async (t) => {
  const app = Fastify({ logger: false })

  t.after(async () => {
    await app.close()
  })

  await app.register(configPlugin, {
    configData: buildConfigData(),
  })

  assert.strictEqual(app.config.ADMIN_PASSWORD, undefined)
})

test('application-config and db-plugin expose configurable MONGO_MAX_POOL_SIZE (20) and MONGO_MIN_POOL_SIZE (2) with min<=max clamping', async (t) => {
  const { resolveMongoPoolOptions } = require('../../plugins/db')

  const defaultApp = Fastify({ logger: false })
  t.after(async () => {
    await defaultApp.close()
  })
  await defaultApp.register(configPlugin, {
    configData: buildConfigData(),
  })

  assert.strictEqual(defaultApp.config.MONGO_MAX_POOL_SIZE, 20)
  assert.strictEqual(defaultApp.config.MONGO_MIN_POOL_SIZE, 2)
  assert.deepStrictEqual(resolveMongoPoolOptions(defaultApp.config), {
    maxPoolSize: 20,
    minPoolSize: 2,
  })

  // Custom overrides and minPoolSize > maxPoolSize clamping
  assert.deepStrictEqual(
    resolveMongoPoolOptions({ MONGO_MAX_POOL_SIZE: 8, MONGO_MIN_POOL_SIZE: 15 }),
    {
      maxPoolSize: 8,
      minPoolSize: 8,
    },
  )
  assert.deepStrictEqual(
    resolveMongoPoolOptions({ MONGO_MAX_POOL_SIZE: 0, MONGO_MIN_POOL_SIZE: -4 }),
    {
      maxPoolSize: 1,
      minPoolSize: 0,
    },
  )
})

test('migration 008-esr-flashcard-drill-index creates and drops the ESR flashcard drill compound index cleanly', async () => {
  const migration008 = require('../../migrations/008-esr-flashcard-drill-index')
  const created = []
  const dropped = []

  const fakeDb = {
    collection(name) {
      assert.strictEqual(name, 'flashcards')
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

  await migration008.up(fakeDb)
  assert.deepStrictEqual(created, [{ userId: 1, noteId: 1, box: 1, nextReviewAt: 1 }])

  await migration008.down(fakeDb)
  assert.deepStrictEqual(dropped, ['userId_1_noteId_1_box_1_nextReviewAt_1'])
})
