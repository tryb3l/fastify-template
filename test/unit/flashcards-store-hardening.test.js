'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const fp = require('fastify-plugin')
const fastify = require('fastify')
const flashcardsStorePlugin = require('../../plugins/flashcards-store')
const { randomUUIDv7 } = require('node:crypto')

describe('Flashcards Store Hardening', () => {
  test('Slice A: reviewFlashcard rejects unknown ratings outside FLASHCARD_RATINGS', async () => {
    const app = fastify()
    app.decorate('mongo', { db: { collection: () => ({}) } })
    app.decorate('notebooksDataSource', {})
    app.decorate('cacheDelete', async () => {})
    app.decorate('httpErrors', {
      badRequest: (msg) => new Error(msg),
      notFound: (msg) => new Error(msg),
    })

    const p1 = fp(async function () {}, { name: 'db-plugin' })
    const p2 = fp(async function () {}, { name: 'notebooks-store' })
    const p3 = fp(async function () {}, { name: 'app-cache' })

    await app.register(p1)
    await app.register(p2)
    await app.register(p3)

    await app.register(flashcardsStorePlugin)
    await app.ready()

    const ds = app.flashcardsDataSource.forUser(randomUUIDv7())

    await assert.rejects(
      () => ds.reviewFlashcard(randomUUIDv7(), 'invalid'),
      /Invalid flashcard rating/,
    )
  })

  test('drillFlashcards with order: shuffled uses aggregate', async () => {
    const app = fastify()
    let aggregateCalled = false
    let findCalled = false

    app.decorate('mongo', {
      db: {
        collection: (name) => {
          if (name === 'notes') {
            return {
              findOne: async () => ({ id: 'n1', userId: 'u1' }),
            }
          }
          if (name === 'flashcards') {
            return {
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
            }
          }
          return {}
        },
      },
    })

    app.decorate('notebooksDataSource', {})
    app.decorate('cacheDelete', async () => {})
    app.decorate('httpErrors', {
      badRequest: (msg) => new Error(msg),
      notFound: (msg) => {
        const e = new Error(msg)
        e.statusCode = 404
        return e
      },
    })

    await app.register(fp(async () => {}, { name: 'db-plugin' }))
    await app.register(fp(async () => {}, { name: 'notebooks-store' }))
    await app.register(fp(async () => {}, { name: 'app-cache' }))
    await app.register(flashcardsStorePlugin)
    await app.ready()

    const ds = app.flashcardsDataSource.forUser('u1')
    await ds.drillFlashcards({ noteId: 'n1', order: 'shuffled', limit: 50 })

    assert.equal(aggregateCalled, true)
    assert.equal(findCalled, false)
  })

  test('reviewFlashcard concurrent delete throws 404', async () => {
    const app = fastify()
    let findOneCount = 0

    app.decorate('mongo', {
      db: {
        collection: (name) => {
          if (name === 'flashcards') {
            return {
              findOne: async () => {
                findOneCount += 1
                if (findOneCount === 1) return { id: 'fc1', box: 1, noteId: 'n1' }
                return null // deleted concurrently
              },
              findOneAndUpdate: async () => null, // modified concurrently
            }
          }
          return {}
        },
      },
    })

    app.decorate('notebooksDataSource', {})
    app.decorate('cacheDelete', async () => {})
    app.decorate('httpErrors', {
      badRequest: (msg) => new Error(msg),
      notFound: (msg) => {
        const e = new Error(msg)
        e.statusCode = 404
        return e
      },
      conflict: (msg) => {
        const e = new Error(msg)
        e.statusCode = 409
        return e
      },
    })

    await app.register(fp(async () => {}, { name: 'db-plugin' }))
    await app.register(fp(async () => {}, { name: 'notebooks-store' }))
    await app.register(fp(async () => {}, { name: 'app-cache' }))
    await app.register(flashcardsStorePlugin)
    await app.ready()

    const ds = app.flashcardsDataSource.forUser('u1')
    try {
      await ds.reviewFlashcard('fc1', 'hard')
      assert.fail('Should throw')
    } catch (err) {
      assert.equal(err.statusCode, 404)
      assert.equal(err.message, 'Flashcard not found')
    }
  })

  test('reviewFlashcard CAS contention throws 409', async () => {
    const app = fastify()
    let findOneCount = 0

    app.decorate('mongo', {
      db: {
        collection: (name) => {
          if (name === 'flashcards') {
            return {
              findOne: async () => {
                findOneCount += 1
                return { id: 'fc1', box: findOneCount, noteId: 'n1' } // card keeps changing
              },
              findOneAndUpdate: async () => null, // update fails
            }
          }
          return {}
        },
      },
    })

    app.decorate('notebooksDataSource', {})
    app.decorate('cacheDelete', async () => {})
    app.decorate('httpErrors', {
      badRequest: (msg) => new Error(msg),
      notFound: (msg) => {
        const e = new Error(msg)
        e.statusCode = 404
        return e
      },
      conflict: (msg) => {
        const e = new Error(msg)
        e.statusCode = 409
        return e
      },
    })

    await app.register(fp(async () => {}, { name: 'db-plugin' }))
    await app.register(fp(async () => {}, { name: 'notebooks-store' }))
    await app.register(fp(async () => {}, { name: 'app-cache' }))
    await app.register(flashcardsStorePlugin)
    await app.ready()

    const ds = app.flashcardsDataSource.forUser('u1')
    try {
      await ds.reviewFlashcard('fc1', 'hard')
      assert.fail('Should throw')
    } catch (err) {
      assert.equal(err.statusCode, 409)
      assert.equal(err.message, 'Flashcard was modified concurrently, please retry')
    }
  })

  test('resolveScopedNotes throws 404 if folder missing', async () => {
    const app = fastify()

    app.decorate('mongo', {
      db: { collection: () => ({}) },
    })

    app.decorate('notebooksDataSource', {
      verifyContainerFilter: async () => ({ folder: null }), // explicitly return no folder
    })
    app.decorate('cacheDelete', async () => {})
    app.decorate('httpErrors', {
      notFound: (msg) => {
        const e = new Error(msg)
        e.statusCode = 404
        return e
      },
    })

    await app.register(fp(async () => {}, { name: 'db-plugin' }))
    await app.register(fp(async () => {}, { name: 'notebooks-store' }))
    await app.register(fp(async () => {}, { name: 'app-cache' }))
    await app.register(flashcardsStorePlugin)
    await app.ready()

    const ds = app.flashcardsDataSource.forUser('u1')
    try {
      await ds.listFlashcards({ folderId: 'f1' })
      assert.fail('Should throw')
    } catch (err) {
      assert.equal(err.statusCode, 404)
      assert.equal(err.message, 'Folder not found')
    }
  })
})
