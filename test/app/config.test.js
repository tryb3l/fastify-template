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
const flashcardsStorePlugin = require('../../plugins/flashcards-store')
const mailerPlugin = require('../../plugins/mailer')
const notebooksStorePlugin = require('../../plugins/notebooks-store')
const notesStorePlugin = require('../../plugins/notes-store')
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

  test('readNote coalesces cold reads, bypasses custom projections, enforces cache decorator metadata, and resists Leitner/edit stale-write races', async (t) => {
    // Arrange 1: verify strict decorator check when cacheFetch/cacheDelete are absent
    const fp = require('fastify-plugin')
    const missingDecoratorApp = Fastify({ logger: false })
    t.after(async () => {
      await missingDecoratorApp.close().catch(() => {})
    })
    missingDecoratorApp.decorate('mongo', { db: { collection: () => ({}) } })
    await missingDecoratorApp.register(fp(async () => {}, { name: 'db-plugin' }))
    await missingDecoratorApp.register(fp(async () => {}, { name: 'app-cache' }))
    missingDecoratorApp.register(usersPlugin)

    // Arrange 2: gated Notes + Flashcards store app to exercise coalescing & mid-flight invalidation
    let noteFindOneCalls = 0
    let releaseNoteGate = () => {}
    let nextNoteFindGate = Promise.resolve()
    const noteState = {
      id: '01950000-0000-7000-8000-000000000099',
      userId: 'u1',
      title: 'Distributed Consensus',
      body: 'Raft leader election notes',
      tags: ['systems'],
      notebookId: null,
      folderId: null,
      readiness: 'to_review',
      noteType: 'standard',
      explicitLinks: [],
      links: [],
      attachments: [],
      revision: 1,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      modifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    }
    const cardState = {
      _id: '01950000-0000-7000-8000-000000000199',
      id: '01950000-0000-7000-8000-000000000199',
      userId: 'u1',
      noteId: noteState.id,
      front: 'What guarantees safety in Raft?',
      back: 'Election restriction + leader completeness',
      box: 3,
      reviewCount: 2,
      lapseCount: 0,
      lastRating: 'good',
      nextReviewAt: new Date('2026-01-01T00:00:00.000Z'),
      lastReviewedAt: new Date('2026-01-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      modifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    }

    const storeApp = Fastify({ logger: false })
    t.after(async () => {
      await storeApp.close()
    })
    storeApp.decorate('httpErrors', {
      badRequest: (msg) => Object.assign(new Error(msg), { statusCode: 400 }),
      notFound: (msg) => Object.assign(new Error(msg), { statusCode: 404 }),
      conflict: (msg) => Object.assign(new Error(msg), { statusCode: 409 }),
    })
    await storeApp.register(configPlugin, {
      configData: buildConfigData({ CACHE_MAX_ENTRIES: '16' }),
    })
    await storeApp.register(cachePlugin)
    await storeApp.register(
      fp(
        async (instance) => {
          instance.decorate('mongo', {
            db: {
              collection(name) {
                if (name === 'notes') {
                  return {
                    async findOne(filter) {
                      noteFindOneCalls += 1
                      const snapshot = { ...noteState }
                      const gate = nextNoteFindGate
                      nextNoteFindGate = Promise.resolve()
                      await gate
                      if (filter.id !== noteState.id || filter.userId !== noteState.userId) {
                        return null
                      }
                      return snapshot
                    },
                    async findOneAndUpdate(_filter, update) {
                      if (update?.$set?.readiness) {
                        noteState.readiness = update.$set.readiness
                      }
                      if (update?.$inc?.revision) {
                        noteState.revision += update.$inc.revision
                      }
                      return { ...noteState }
                    },
                  }
                }
                if (name === 'flashcards') {
                  return {
                    async findOne(filter) {
                      return filter.id === cardState.id ? { ...cardState } : null
                    },
                    async findOneAndUpdate(_filter, update) {
                      Object.assign(cardState, update.$set)
                      if (update.$inc?.reviewCount) {
                        cardState.reviewCount += update.$inc.reviewCount
                      }
                      return { ...cardState }
                    },
                    find() {
                      return {
                        toArray: async () => [{ box: cardState.box }],
                      }
                    },
                  }
                }
                return {
                  findOne: async () => null,
                  insertOne: async () => ({ insertedId: '1' }),
                }
              },
            },
          })
        },
        { name: 'db-plugin' },
      ),
    )
    await storeApp.register(
      fp(
        async (instance) => {
          instance.decorate('notesFileManager', { deleteNoteAttachments: async () => {} })
        },
        { name: 'notes-file-manager' },
      ),
    )
    await storeApp.register(notebooksStorePlugin)
    await storeApp.register(flashcardsStorePlugin)
    await storeApp.register(notesStorePlugin)
    await storeApp.ready()

    // Act & Assert 1: missing cache decorators fail Fastify boot
    await assert.rejects(
      () => missingDecoratorApp.ready(),
      (err) =>
        err.code === 'FST_ERR_PLUGIN_NOT_PRESENT_IN_INSTANCE' && /cacheDelete/.test(err.message),
    )

    // Act 2: concurrent cold readNote calls coalesce into 1 findOne, while projection reads bypass cache
    nextNoteFindGate = new Promise((resolve) => {
      releaseNoteGate = resolve
    })
    const coldNote1 = storeApp.notesDataSource.readNote(noteState.id, 'u1')
    const coldNote2 = storeApp.notesDataSource.readNote(noteState.id, 'u1')
    releaseNoteGate()
    const [noteRes1, noteRes2] = await Promise.all([coldNote1, coldNote2])
    await storeApp.notesDataSource.readNote(noteState.id, 'u1', { title: 1 })

    // Assert 2
    assert.equal(noteFindOneCalls, 2)
    assert.equal(noteRes1.revision, 1)
    assert.equal(noteRes2.revision, 1)
    assert.equal(storeApp.cacheGet(`note:${noteState.id}:u1`)?.readiness, 'to_review')

    // Act 3: Leitner Drill Flashcard review promotes Note Readiness to mastered while slow readNote is in flight
    storeApp.cacheDelete(`note:${noteState.id}:u1`)
    nextNoteFindGate = new Promise((resolve) => {
      releaseNoteGate = resolve
    })
    const staleInFlightNoteRead = storeApp.notesDataSource.readNote(noteState.id, 'u1')
    await Promise.resolve()
    const reviewOutcome = await storeApp.flashcardsDataSource.reviewFlashcard(
      cardState.id,
      'good',
      'u1',
    )
    releaseNoteGate()
    const staleCallerNote = await staleInFlightNoteRead
    const freshNoteAfterDrill = await storeApp.notesDataSource.readNote(noteState.id, 'u1')

    // Assert 3: caller gets pre-review snapshot without AbortError, cache was NOT poisoned, and fresh read sees mastered!
    assert.equal(reviewOutcome.noteReadiness, 'mastered')
    assert.equal(staleCallerNote.readiness, 'to_review')
    assert.equal(freshNoteAfterDrill.readiness, 'mastered')
    assert.equal(storeApp.cacheGet(`note:${noteState.id}:u1`)?.readiness, 'mastered')
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
