'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const Fastify = require('fastify')
const fp = require('fastify-plugin')
const stream = require('stream')

// Mock @fastify/mongodb to prevent actual connection attempts and 5-second hangs
const requireCachePath = require.resolve('@fastify/mongodb')
require.cache[requireCachePath] = {
  id: requireCachePath,
  filename: requireCachePath,
  loaded: true,
  exports: fp(async () => {}), // Dummy plugin
}

const dbPlugin = require('../../plugins/db')

test('db-plugin redacts usernames and passwords from MONGO_URL in debug logs', async (t) => {
  const scenarios = [
    {
      url: 'mongodb://user:pass@host:27017/db',
      expected: 'mongodb://***@host:27017/db',
    },
    {
      url: 'mongodb+srv://admin:secret@cluster.example.net/prod',
      expected: 'mongodb+srv://***@cluster.example.net/prod',
    },
    {
      url: 'mongodb://u:p%40ss@h1:27017,h2:27017/db?replicaSet=rs0',
      expected: 'mongodb://***@h1:27017,h2:27017/db?replicaSet=rs0',
    },
  ]

  for (const { url, expected } of scenarios) {
    await t.test(`redacts ${url}`, async () => {
      const logMessages = []
      const ws = new stream.Writable({
        write(chunk, enc, cb) {
          logMessages.push(chunk.toString())
          cb()
        },
      })

      const fastify = Fastify({
        logger: {
          level: 'debug',
          stream: ws,
        },
      })

      // Mock application-config plugin to provide MONGO_URL
      fastify.register(
        fp(
          async (fastify) => {
            fastify.decorate('config', {
              MONGO_URL: url,
              MONGO_MAX_POOL_SIZE: 10,
              MONGO_MIN_POOL_SIZE: 2,
            })
          },
          { name: 'application-config' },
        ),
      )

      fastify.register(dbPlugin)

      await fastify.ready()

      const debugLog = logMessages.find((msg) =>
        msg.includes('Attempting to connect to MongoDB at:'),
      )
      assert.ok(debugLog, 'Debug log should be emitted')

      const parsedLog = JSON.parse(debugLog)
      const loggedMsg = parsedLog.msg

      assert.ok(
        !loggedMsg.includes('pass') &&
          !loggedMsg.includes('secret') &&
          !loggedMsg.includes('p%40ss'),
        'Password should not be in the log',
      )
      assert.ok(
        !loggedMsg.includes('user:') && !loggedMsg.includes('admin:') && !loggedMsg.includes('u:'),
        'Username should not be in the log',
      )

      assert.ok(
        loggedMsg.includes(expected),
        `Log should contain redacted URL: ${expected}. Actual: ${loggedMsg}`,
      )
    })
  }
})
