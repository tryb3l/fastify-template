'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { buildApp } = require('../../../test-setup')
const { randomStringWithPrefix } = require('../../../utils/data-creator')

test('GET random path 404 - not-found handler returns standard 404 JSON', async (t) => {
  // Arrange
  const app = await buildApp(t)
  const nonExistentRoute = randomStringWithPrefix('/', 'abcdefghijklmnopqrstuvwxyz0123456789', 20)

  // Act
  const res = await app.inject({
    method: 'GET',
    url: nonExistentRoute,
  })

  // Assert
  assert.strictEqual(res.statusCode, 404)

  const payload = res.json()
  assert.strictEqual(payload.statusCode, 404)
  assert.strictEqual(payload.error, 'Not Found')
  assert.strictEqual(payload.message, 'The requested resource could not be found')

  assert.ok(payload.requestId, 'Should contain a requestId')
  assert.strictEqual(typeof payload.requestId, 'string', 'requestId should be a string')
  assert.strictEqual(res.headers['x-request-id'], payload.requestId)
})

test('GET random path 404 - ignores inbound x-request-id and returns canonical request id', async (t) => {
  // Arrange
  const app = await buildApp(t)
  const nonExistentRoute = randomStringWithPrefix('/', 'abcdefghijklmnopqrstuvwxyz0123456789', 20)
  const inboundRequestId = 'client-controlled-request-id'

  // Act
  const res = await app.inject({
    method: 'GET',
    url: nonExistentRoute,
    headers: {
      'x-request-id': inboundRequestId,
    },
  })

  // Assert
  assert.strictEqual(res.statusCode, 404)

  const payload = res.json()
  assert.strictEqual(typeof payload.requestId, 'string')
  assert.strictEqual(res.headers['x-request-id'], payload.requestId)
  assert.notStrictEqual(payload.requestId, inboundRequestId)
})
