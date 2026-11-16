'use strict'

const test = require('node:test')
const assert = require('node:assert')
const Fastify = require('fastify')
const notesStorePlugin = require('../../plugins/notes-store')
const notebooksStorePlugin = require('../../plugins/notebooks-store')
const flashcardsStorePlugin = require('../../plugins/flashcards-store')
const userRoutes = require('../../routes/users/routes')

function createConcurrencyTracker() {
  let active = 0
  let maxActive = 0

  async function track(work) {
    active += 1
    if (active > maxActive) {
      maxActive = active
    }
    // Yield a macrotask turn so concurrent Promise.all branches enter before the first finishes
    await new Promise((resolve) => setImmediate(resolve))
    try {
      return await work()
    } finally {
      active -= 1
    }
  }

  return {
    track,
    getMaxActive: () => maxActive,
    reset: () => {
      active = 0
      maxActive = 0
    },
  }
}

test('GET /users dispatches listUsers and countUsers concurrently in Promise.all', async (t) => {
  const tracker = createConcurrencyTracker()
  const app = Fastify({ logger: false })
  t.after(async () => {
    await app.close()
  })

  const schemasLoader = require('../../schemas/loader')
  await app.register(schemasLoader)

  app.decorate('httpErrors', {
    badRequest: (msg) => Object.assign(new Error(msg), { statusCode: 400 }),
    notFound: (msg) => Object.assign(new Error(msg), { statusCode: 404 }),
  })
  app.decorate('authorize', () => async (req) => {
    req.user = { _id: 'admin-1', role: 'admin' }
  })
  app.decorate('usersDataSource', {
    listUsers: ({ skip, limit }) =>
      tracker.track(async () => {
        assert.strictEqual(skip, 0)
        assert.strictEqual(limit, 10)
        return [{ id: '01950000-0000-7000-8000-000000000001', username: 'alice' }]
      }),
    countUsers: () => tracker.track(async () => 1),
  })

  await app.register(userRoutes, { prefix: '/users' })

  const res = await app.inject({ method: 'GET', url: '/users' })
  assert.strictEqual(res.statusCode, 200)
  assert.strictEqual(res.json().totalCount, 1)
  assert.strictEqual(res.json().data.length, 1)
  assert.strictEqual(
    tracker.getMaxActive(),
    2,
    'Expected listUsers and countUsers to run concurrently in Promise.all',
  )
})

test('notes-store, notebooks-store, and flashcards-store parallelize independent secondary MongoDB round-trips', async (t) => {
  const tracker = createConcurrencyTracker()
  const app = Fastify({ logger: false })
  t.after(async () => {
    await app.close()
  })

  const collections = {
    notes: {
      insertOne: (doc) => tracker.track(async () => ({ insertedId: doc._id })),
      insertMany: (docs) => tracker.track(async () => ({ insertedCount: docs.length })),
      findOne: (query) =>
        tracker.track(async () => ({
          id: query.id || '01950000-0000-7000-8000-000000000010',
          userId: 'u1',
          title: 'Parent',
          body: '',
          tags: [],
          readiness: 'to_review',
          noteType: 'standard',
          revision: 1,
          modifiedAt: new Date(),
        })),
      findOneAndUpdate: () =>
        Promise.resolve({
          id: '01950000-0000-7000-8000-000000000010',
          userId: 'u1',
          title: 'Parent',
          body: '',
          tags: [],
          readiness: 'in_progress',
          noteType: 'standard',
          revision: 2,
          modifiedAt: new Date(),
        }),
      findOneAndDelete: () =>
        Promise.resolve({
          id: '01950000-0000-7000-8000-000000000010',
          userId: 'u1',
          revision: 1,
          attachments: [{ fileId: 'f1', storedPath: 'u1/f1' }],
        }),
      find: () => ({
        toArray: () => tracker.track(async () => [{ id: 'ref-1' }]),
      }),
      updateMany: () => tracker.track(async () => ({ modifiedCount: 1 })),
      countDocuments: () => Promise.resolve(0),
    },
    notebooks: {
      findOne: () =>
        Promise.resolve({
          id: 'nb-1',
          userId: 'u1',
          name: 'NB',
          description: '',
          mode: 'notebook',
          status: 'active',
          targetDate: null,
          createdAt: new Date(),
          modifiedAt: new Date(),
        }),
      deleteOne: () => tracker.track(async () => ({ deletedCount: 1 })),
    },
    folders: {
      findOne: () => Promise.resolve({ id: 'fold-1', notebookId: 'nb-1', name: 'F' }),
      deleteOne: () => tracker.track(async () => ({ deletedCount: 1 })),
      countDocuments: () => Promise.resolve(0),
    },
    flashcards: {
      insertOne: (doc) => tracker.track(async () => ({ insertedId: doc._id })),
      findOne: () =>
        Promise.resolve({
          id: 'fc-1',
          noteId: '01950000-0000-7000-8000-000000000010',
          box: 1,
        }),
      findOneAndUpdate: () =>
        Promise.resolve({
          id: 'fc-1',
          noteId: '01950000-0000-7000-8000-000000000010',
          front: 'Q',
          back: 'A',
          box: 2,
          nextReviewAt: new Date(),
          lastReviewedAt: new Date(),
          reviewCount: 1,
          lapseCount: 0,
          lastRating: 'good',
          createdAt: new Date(),
          modifiedAt: new Date(),
        }),
      find: () => ({
        toArray: () => tracker.track(async () => [{ id: 'fc-1', box: 2 }]),
      }),
      deleteMany: () => tracker.track(async () => ({ deletedCount: 1 })),
    },
    syncTombstones: {
      insertOne: () => tracker.track(async () => ({ insertedId: 't1' })),
      insertMany: () => tracker.track(async () => ({ insertedCount: 1 })),
    },
  }

  app.decorate('httpErrors', {
    badRequest: (msg) => Object.assign(new Error(msg), { statusCode: 400 }),
    notFound: (msg) => Object.assign(new Error(msg), { statusCode: 404 }),
    conflict: (msg) => Object.assign(new Error(msg), { statusCode: 409 }),
  })

  // Emulate fastify-plugin dependencies for isolated store unit test
  app.decorate('mongo', {
    db: {
      collection: (name) => collections[name],
    },
  })
  app.decorate('cacheGet', async () => null)
  app.decorate('cacheSet', async () => {})
  app.decorate('cacheDelete', () => tracker.track(async () => {}))
  app.decorate('recordDailyActivity', () => tracker.track(async () => {}))
  app.decorate('notesFileManager', {
    deleteNoteAttachments: () => tracker.track(async () => {}),
  })

  // Register plugins without named dependency checks by invoking the raw plugin functions via override or mock db-plugin
  const fp = require('fastify-plugin')
  await app.register(fp(async () => {}, { name: 'db-plugin' }))
  await app.register(fp(async () => {}, { name: 'app-cache' }))
  await app.register(fp(async () => {}, { name: 'notes-file-manager' }))
  await app.register(notebooksStorePlugin)
  await app.register(flashcardsStorePlugin)
  await app.register(notesStorePlugin)
  await app.ready()

  // 1. createNote runs insertOne + recordDailyActivity concurrently (maxActive === 2)
  tracker.reset()
  await app.notesDataSource.createNote({ title: 'Parallel Note', body: 'Hello' }, 'u1')
  assert.strictEqual(
    tracker.getMaxActive(),
    2,
    'Expected createNote to parallelize insertOne + recordDailyActivity',
  )

  // 2. deleteNote runs cascade branches concurrently (maxActive >= 4)
  tracker.reset()
  await app.notesDataSource.deleteNote('01950000-0000-7000-8000-000000000010', 'u1', 1)
  assert.ok(
    tracker.getMaxActive() >= 4,
    `Expected deleteNote cascade branches to run concurrently (>=4), got ${tracker.getMaxActive()}`,
  )

  // 3. deleteNotebook and deleteFolder run deleteOne + syncTombstone concurrently (maxActive === 2)
  tracker.reset()
  await app.notebooksDataSource.deleteNotebook('nb-1', 'u1')
  assert.strictEqual(
    tracker.getMaxActive(),
    2,
    'Expected deleteNotebook to parallelize deleteOne + syncTombstone',
  )

  tracker.reset()
  await app.notebooksDataSource.deleteFolder('fold-1', 'u1')
  assert.strictEqual(
    tracker.getMaxActive(),
    2,
    'Expected deleteFolder to parallelize deleteOne + syncTombstone',
  )

  // 4. createFlashcard runs insertOne + recordDailyActivity concurrently (maxActive === 2)
  tracker.reset()
  await app.flashcardsDataSource.createFlashcard(
    { noteId: '01950000-0000-7000-8000-000000000010', front: 'Q', back: 'A' },
    'u1',
  )
  assert.strictEqual(
    tracker.getMaxActive(),
    2,
    'Expected createFlashcard to parallelize insertOne + recordDailyActivity',
  )

  // 5. reviewFlashcard runs recordDailyActivity + flashcards.find + notes.findOne concurrently (maxActive === 3)
  tracker.reset()
  await app.flashcardsDataSource.reviewFlashcard('fc-1', 'good', 'u1')
  assert.strictEqual(
    tracker.getMaxActive(),
    3,
    'Expected reviewFlashcard to parallelize recordDailyActivity + flashcards.find + notes.findOne',
  )
})
