'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const fp = require('fastify-plugin')
const fastify = require('fastify')
const flashcardsStorePlugin = require('../../plugins/flashcards-store')
const { randomUUIDv7 } = require('node:crypto')

async function buildIsolatedFlashcardsApp(t, { collections = {}, notebooksDataSource = {} } = {}) {
  const app = fastify({ logger: false })
  t.after(async () => {
    await app.close()
  })

  app.decorate('mongo', {
    db: {
      collection: (name) => collections[name] || {},
    },
  })
  app.decorate('notebooksDataSource', notebooksDataSource)
  app.decorate('cacheDelete', async () => {})
  app.decorate('httpErrors', {
    badRequest: (msg) => Object.assign(new Error(msg), { statusCode: 400 }),
    notFound: (msg) => Object.assign(new Error(msg), { statusCode: 404 }),
    conflict: (msg) => Object.assign(new Error(msg), { statusCode: 409 }),
  })

  await app.register(fp(async () => {}, { name: 'db-plugin' }))
  await app.register(fp(async () => {}, { name: 'notebooks-store' }))
  await app.register(fp(async () => {}, { name: 'app-cache' }))
  await app.register(flashcardsStorePlugin)
  await app.ready()

  return app
}

describe('Flashcards Store Hardening', () => {
  test('reviewFlashcard rejects unknown ratings outside FLASHCARD_RATINGS', async (t) => {
    const app = await buildIsolatedFlashcardsApp(t)
    const ds = app.flashcardsDataSource.forUser(randomUUIDv7())

    await assert.rejects(
      () => ds.reviewFlashcard(randomUUIDv7(), 'invalid'),
      (err) => err.statusCode === 400 && /Invalid flashcard rating/.test(err.message),
    )
  })

  test('drillFlashcards with order: shuffled uses aggregate $sample without find', async (t) => {
    let aggregateCalled = false
    let findCalled = false

    const app = await buildIsolatedFlashcardsApp(t, {
      collections: {
        notes: {
          findOne: async () => ({ id: 'n1', userId: 'u1' }),
        },
        flashcards: {
          aggregate: (pipeline) => {
            aggregateCalled = true
            assert.ok(pipeline.some((s) => s.$sample && s.$sample.size === 50))
            assert.ok(pipeline.some((s) => s.$match))
            assert.ok(pipeline.some((s) => s.$project))
            return { toArray: async () => [{ id: 'fc1', noteId: 'n1' }] }
          },
          find: () => {
            findCalled = true
            return {
              sort: () => ({ limit: () => {}, toArray: async () => [] }),
              limit: () => {},
              toArray: async () => [],
            }
          },
        },
      },
    })

    const ds = app.flashcardsDataSource.forUser('u1')
    await ds.drillFlashcards({ noteId: 'n1', order: 'shuffled', limit: 50 })

    assert.equal(aggregateCalled, true)
    assert.equal(findCalled, false)
  })

  test('reviewFlashcard concurrent delete throws 404', async (t) => {
    let findOneCount = 0

    const app = await buildIsolatedFlashcardsApp(t, {
      collections: {
        flashcards: {
          findOne: async () => {
            findOneCount += 1
            if (findOneCount === 1) return { id: 'fc1', box: 1, reviewCount: 0, noteId: 'n1' }
            return null
          },
          findOneAndUpdate: async () => null,
        },
      },
    })

    const ds = app.flashcardsDataSource.forUser('u1')
    await assert.rejects(
      () => ds.reviewFlashcard('fc1', 'hard'),
      (err) => err.statusCode === 404 && err.message === 'Flashcard not found',
    )
  })

  test('reviewFlashcard CAS contention on reviewCount throws 409 even when box stays constant (e.g. hard or box 5)', async (t) => {
    let findOneCount = 0

    const app = await buildIsolatedFlashcardsApp(t, {
      collections: {
        flashcards: {
          findOne: async () => {
            findOneCount += 1
            return { id: 'fc1', box: 5, reviewCount: findOneCount, noteId: 'n1' }
          },
          findOneAndUpdate: async () => null,
        },
      },
    })

    const ds = app.flashcardsDataSource.forUser('u1')
    await assert.rejects(
      () => ds.reviewFlashcard('fc1', 'good'),
      (err) =>
        err.statusCode === 409 &&
        err.message === 'Flashcard was modified concurrently, please retry',
    )
  })

  test('reviewFlashcard handles legacy documents missing box and reviewCount fields using reviewCount CAS', async (t) => {
    let capturedFilter = null
    const now = new Date()

    const app = await buildIsolatedFlashcardsApp(t, {
      collections: {
        flashcards: {
          findOne: async () => ({ id: 'fc-legacy', noteId: 'n1' }),
          findOneAndUpdate: async (filter) => {
            capturedFilter = filter
            if (filter.box !== undefined) {
              // Simulate real MongoDB: { box: 1 } does NOT match a doc missing `box`!
              return null
            }
            return {
              id: 'fc-legacy',
              noteId: 'n1',
              front: 'Q',
              back: 'A',
              box: 2,
              nextReviewAt: now,
              lastReviewedAt: now,
              reviewCount: 1,
              lapseCount: 0,
              lastRating: 'good',
              createdAt: now,
              modifiedAt: now,
            }
          },
          find: () => ({ toArray: async () => [{ box: 2 }] }),
        },
        notes: {
          findOne: async () => ({ id: 'n1', userId: 'u1', readiness: 'in_progress' }),
        },
      },
    })

    const ds = app.flashcardsDataSource.forUser('u1')
    const res = await ds.reviewFlashcard('fc-legacy', 'good')

    assert.equal(res.flashcard.box, 2)
    assert.equal(res.flashcard.reviewCount, 1)
    assert.ok(Array.isArray(capturedFilter.$or), 'Expected $or fallback for missing/0 reviewCount')
    assert.equal(capturedFilter.box, undefined)
  })

  test('resolveScopedNotes throws 404 if folder missing', async (t) => {
    const app = await buildIsolatedFlashcardsApp(t, {
      notebooksDataSource: {
        verifyContainerFilter: async () => ({ folder: null }),
      },
    })

    const ds = app.flashcardsDataSource.forUser('u1')
    await assert.rejects(
      () => ds.listFlashcards({ folderId: 'f1' }),
      (err) => err.statusCode === 404 && err.message === 'Folder not found',
    )
  })
})
