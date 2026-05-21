'use strict'

const test = require('node:test')
const assert = require('node:assert')
const split = require('split2')
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
  const logs = []
  const stream = split((line) => {
    try {
      return JSON.parse(line)
    } catch {
      return null
    }
  })

  const logCollection = (async () => {
    for await (const log of stream) {
      if (log) logs.push(log)
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
  const logs = []
  const stream = split((line) => {
    try {
      return JSON.parse(line)
    } catch {
      return null
    }
  })

  const logCollection = (async () => {
    for await (const log of stream) {
      if (log) logs.push(log)
    }
  })()

  const app = await buildLoggedApp(t, stream)

  const spoofedRequestId = 'user-supplied-request-id'

  const response = await app.inject({
    method: 'GET',
    url: '/definitely-missing-route',
    headers: {
      'x-request-id': spoofedRequestId,
    },
  })

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
  const stream = split((line) => {
    try {
      return JSON.parse(line)
    } catch {
      return null
    }
  })

  const logCollection = (async () => {
    for await (const log of stream) {
      if (log) logs.push(log)
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
