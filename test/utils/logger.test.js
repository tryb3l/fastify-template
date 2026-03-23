'use strict'

const test = require('node:test')
const assert = require('node:assert')
const split = require('split2')
const { buildApp } = require('../helper')
const loggerOptions = require('../../configs/logger-options')
const { randomString, randomStringWithPrefix } = require('./data-creator')

test('logger must redact sensitive authorization headers', async (t) => {
  const logs = []
  const stream = split((line) => {
    try {
      return JSON.parse(line)
    } catch (err) {
      return null
    }
  })

  const logCollection = (async () => {
    for await (const log of stream) {
      if (log) logs.push(log)
    }
  })()

  const app = await buildApp(t, {}, {
    logger: {
      ...loggerOptions,
      stream,
      // Ensure level is at least info so we actually get logs
      level: 'info'
    },
  })

  const requestId = randomStringWithPrefix('logger-', 'abcdefghijklmnopqrstuvwxyz0123456789', 24)
  const fakeToken = randomString('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 32)

  // Act
  const response = await app.inject({
    method: 'GET',
    url: '/notes',
    headers: {
      Authorization: `Bearer ${fakeToken}`,
      'x-amz-request-id': requestId,
    },
  })

  // Assert
  assert.strictEqual(response.statusCode, 401)

  await new Promise(resolve => setTimeout(resolve, 250))

  stream.end()
  await logCollection

  const requestLog = logs.find((line) =>
    line.req &&
    line.req.headers &&
    line.req.headers['x-amz-request-id'] === requestId
  )

  assert.ok(requestLog, `Could not find log entry with requestId: ${requestId}. Found ${logs.length} logs.`)

  const authHeader = requestLog.req.headers.authorization
  assert.strictEqual(
    authHeader,
    '*****',
    `Authorization header was not redacted! Got: ${authHeader}`
  )
})