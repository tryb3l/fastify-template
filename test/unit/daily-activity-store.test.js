'use strict'

const test = require('node:test')
const assert = require('node:assert')
const Fastify = require('fastify')
const fp = require('fastify-plugin')
const dailyActivityStorePlugin = require('../../plugins/daily-activity-store')

test('Slice 1: recordDailyActivity retries once on E11000 race and accumulates increments', async (t) => {
  const app = Fastify({ logger: false })
  t.after(async () => {
    await app.close()
  })

  let updateOneCalls = 0

  app.decorate('mongo', {
    db: {
      collection: (name) => {
        if (name === 'dailyActivity') {
          return {
            updateOne: async () => {
              updateOneCalls += 1
              if (updateOneCalls === 1) {
                const err = new Error('E11000 duplicate key error')
                err.code = 11000
                throw err
              }
              return { matchedCount: 1, modifiedCount: 1 }
            },
            find: () => ({ toArray: async () => [] }),
          }
        }
        return {
          countDocuments: async () => 0,
          find: () => ({ toArray: async () => [] }),
          sort: () => ({ toArray: async () => [] }),
        }
      },
    },
  })

  await app.register(fp(async () => {}, { name: 'db-plugin' }))
  await app.register(dailyActivityStorePlugin)
  await app.ready()

  await app.recordDailyActivity('u1', { notesCreated: 1 })
  assert.strictEqual(updateOneCalls, 2)
})

test('Slice 2: recordDailyActivity logs warning and swallows persistent DB errors', async (t) => {
  let loggedWarnings = 0
  const app = Fastify({ logger: false })
  t.after(async () => {
    await app.close()
  })

  // Override log.warn after creation
  app.log.warn = () => {
    loggedWarnings += 1
  }

  app.decorate('mongo', {
    db: {
      collection: (name) => {
        if (name === 'dailyActivity') {
          return {
            updateOne: async () => {
              const err = new Error('Some DB explosion')
              err.code = 1234
              throw err
            },
            find: () => ({ toArray: async () => [] }),
          }
        }
        return {
          countDocuments: async () => 0,
          find: () => ({ toArray: async () => [] }),
          sort: () => ({ toArray: async () => [] }),
        }
      },
    },
  })

  await app.register(fp(async () => {}, { name: 'db-plugin' }))
  await app.register(dailyActivityStorePlugin)
  await app.ready()

  // This should NOT throw
  await app.recordDailyActivity('u1', { flashcardsCreated: 1 })

  assert.strictEqual(loggedWarnings, 1, 'Expected one warning to be logged')
})
