'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { createInterface } = require('node:readline/promises')
const { PassThrough } = require('node:stream')
const Fastify = require('fastify')
const serverOptions = require('../../configs/server-options')
const errorHandlerPlugin = require('../../plugins/error-handler')
const { randomString, randomStringWithPrefix } = require('./data-creator')

async function buildLoggedApp(t, stream) {
  const app = Fastify({
    ...serverOptions,
    logger: {
      ...serverOptions.logger,
      stream,
      level: 'info',
    },
  })

  await app.register(errorHandlerPlugin)

  t.after(async () => {
    await app.close()
  })

  return app
}

test('logger must redact sensitive authorization headers', async (t) => {
  // Arrange
  const logs = []
  const stream = new PassThrough()
  const rl = createInterface({ input: stream, crlfDelay: Infinity })

  const logCollection = (async () => {
    for await (const line of rl) {
      try {
        logs.push(JSON.parse(line))
      } catch {
        // ignore non-JSON lines
      }
    }
  })()

  const app = await buildLoggedApp(t, stream)

  const requestId = randomStringWithPrefix('logger-', 'abcdefghijklmnopqrstuvwxyz0123456789', 24)
  const fakeToken = randomString(
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    32,
  )

  // Act
  const response = await app.inject({
    method: 'GET',
    url: '/missing-redaction-check',
    headers: {
      Authorization: `Bearer ${fakeToken}`,
      'x-amz-request-id': requestId,
    },
  })

  // Assert
  assert.strictEqual(response.statusCode, 404)

  const responseRequestId = response.json().requestId
  assert.strictEqual(typeof responseRequestId, 'string')
  assert.notStrictEqual(responseRequestId, requestId)
  assert.strictEqual(response.headers['x-request-id'], responseRequestId)

  await new Promise((resolve) => setTimeout(resolve, 250))

  stream.end()
  await logCollection

  const requestLog = logs.find((line) => line.msg === 'incoming request')

  assert.ok(requestLog, `Could not find incoming request log. Found ${logs.length} logs.`)
  assert.strictEqual(requestLog.requestId, responseRequestId)
  assert.strictEqual(requestLog.req.headers['x-amz-request-id'], requestId)

  const authHeader = requestLog.req.headers.authorization
  assert.strictEqual(
    authHeader,
    '*****',
    `Authorization header was not redacted! Got: ${authHeader}`,
  )
})

test('logger emits a top-level canonical requestId field for request logs', async (t) => {
  // Arrange
  const logs = []
  const stream = new PassThrough()
  const rl = createInterface({ input: stream, crlfDelay: Infinity })

  const logCollection = (async () => {
    for await (const line of rl) {
      try {
        logs.push(JSON.parse(line))
      } catch {
        // ignore non-JSON lines
      }
    }
  })()

  const app = await buildLoggedApp(t, stream)

  const spoofedRequestId = 'user-supplied-request-id'

  // Act
  const response = await app.inject({
    method: 'GET',
    url: '/definitely-missing-route',
    headers: {
      'x-request-id': spoofedRequestId,
    },
  })

  // Assert
  assert.strictEqual(response.statusCode, 404)

  const responseRequestId = response.json().requestId
  assert.strictEqual(response.headers['x-request-id'], responseRequestId)
  assert.notStrictEqual(responseRequestId, spoofedRequestId)

  await new Promise((resolve) => setTimeout(resolve, 250))

  stream.end()
  await logCollection

  const requestLog = logs.find(
    (line) =>
      line.msg === 'incoming request' && line.req?.headers?.['x-request-id'] === spoofedRequestId,
  )

  assert.ok(requestLog, `Could not find an incoming request log. Found ${logs.length} logs.`)
  assert.strictEqual(requestLog.requestId, responseRequestId)
  assert.notStrictEqual(requestLog.requestId, spoofedRequestId)
})

test('logger records handled client errors as warnings with final status code', async (t) => {
  // Arrange
  const logs = []
  const stream = new PassThrough()
  const rl = createInterface({ input: stream, crlfDelay: Infinity })

  const logCollection = (async () => {
    for await (const line of rl) {
      try {
        logs.push(JSON.parse(line))
      } catch {
        // ignore non-JSON lines
      }
    }
  })()

  const app = await buildLoggedApp(t, stream)
  app.get('/client-error', async () => {
    const err = new Error('Client-side authentication failure')
    err.statusCode = 401
    throw err
  })

  // Act
  const response = await app.inject({
    method: 'GET',
    url: '/client-error',
  })

  // Assert
  assert.strictEqual(response.statusCode, 401)

  await new Promise((resolve) => setTimeout(resolve, 250))

  stream.end()
  await logCollection

  const errorLog = logs.find((line) => line.msg === 'Client-side authentication failure')

  assert.ok(errorLog, `Could not find client error log. Found ${logs.length} logs.`)
  assert.strictEqual(errorLog.level, 40)
  assert.strictEqual(errorLog.res.statusCode, 401)
})

test('logger must redact sensitive cookie and set-cookie headers', async (t) => {
  const logs = []
  const stream = new PassThrough()
  const rl = createInterface({ input: stream, crlfDelay: Infinity })

  const logCollection = (async () => {
    for await (const line of rl) {
      try {
        logs.push(JSON.parse(line))
      } catch {
        // ignore non-JSON lines
      }
    }
  })()

  const app = await buildLoggedApp(t, stream)
  app.post('/cookie-check', async (_req, reply) => {
    reply.header('set-cookie', 'refreshToken=super-secret-refresh-token; HttpOnly; Path=/auth')
    return { ok: true }
  })

  const response = await app.inject({
    method: 'POST',
    url: '/cookie-check',
    headers: {
      cookie: 'refreshToken=incoming-secret-refresh-token; _csrf=secret-csrf',
    },
  })

  assert.strictEqual(response.statusCode, 200)

  await new Promise((resolve) => setTimeout(resolve, 250))

  stream.end()
  await logCollection

  const incomingLog = logs.find((line) => line.msg === 'incoming request')
  const completedLog = logs.find((line) => line.msg === 'request completed')

  assert.ok(incomingLog, 'Expected incoming request log')
  assert.ok(completedLog, 'Expected request completed log')
  assert.strictEqual(incomingLog.req.headers.cookie, '*****')
  assert.strictEqual(completedLog.req.headers.cookie, '*****')
  assert.strictEqual(completedLog.res?.headers?.['set-cookie'], '*****')
})

test('logger at info level emits only request-boundary logs without method entry/exit trace spam', async (t) => {
  const logs = []
  const stream = new PassThrough()
  const rl = createInterface({ input: stream, crlfDelay: Infinity })

  const logCollection = (async () => {
    for await (const line of rl) {
      try {
        logs.push(JSON.parse(line))
      } catch {
        // ignore non-JSON lines
      }
    }
  })()

  const app = Fastify({
    ...serverOptions,
    logger: {
      ...serverOptions.logger,
      stream,
      level: 'info',
    },
  })

  const fp = require('fastify-plugin')
  await app.register(
    fp(
      async (instance) => {
        instance.decorate('config', {
          jwt: {
            secret: 'test-jwt-secret-1234567890',
            accessExpireIn: '1h',
            refreshExpireIn: '30d',
          },
        })
      },
      { name: 'application-config' },
    ),
  )
  await app.register(fp(async () => {}, { name: 'cookie-plugin' }))
  await app.register(
    fp(
      async (instance) => {
        instance.decorate('usersDataSource', {
          async readUserById(id) {
            return { _id: id, id, username: 'tester', role: 'user', credentialsVersion: 0 }
          },
        })
      },
      { name: 'users-store' },
    ),
  )

  await app.register(require('../../plugins/error-handler'))
  await app.register(require('../../plugins/auth'))

  app.get('/protected-note', { onRequest: [app.authenticate] }, async () => {
    return { data: { id: '123', title: 'Quiet Note' } }
  })

  t.after(async () => {
    await app.close()
  })

  await app.ready()
  const token = app.jwt.sign({
    sub: 'user-1',
    username: 'tester',
    role: 'user',
    cv: 0,
    type: 'access',
  })

  // Clear startup logs so we only inspect request-time logs
  await new Promise((resolve) => setTimeout(resolve, 50))
  logs.length = 0

  const response = await app.inject({
    method: 'GET',
    url: '/protected-note',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  assert.strictEqual(response.statusCode, 200)

  await new Promise((resolve) => setTimeout(resolve, 150))
  stream.end()
  await logCollection

  const messages = logs.map((line) => line.msg)
  assert.deepStrictEqual(messages, ['incoming request', 'request completed'])
})
