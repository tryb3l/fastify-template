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
})
