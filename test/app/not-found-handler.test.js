'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { buildApp } = require('../test-setup')
const { randomStringWithPrefix } = require('../utils/data-creator')

describe('Not-found handler', () => {
  test('returns standard 404 JSON envelope for unknown GET routes', async (t) => {
    // Arrange
    const app = await buildApp(t)
    const nonExistentRoute = randomStringWithPrefix('/', 'abcdefghijklmnopqrstuvwxyz0123456789', 20)

    // Act
    const response = await app.inject({
      method: 'GET',
      url: nonExistentRoute,
    })

    // Assert
    assert.equal(response.statusCode, 404)
    const payload = response.json()
    assert.equal(payload.statusCode, 404)
    assert.equal(payload.error, 'Not Found')
    assert.equal(payload.message, 'The requested resource could not be found')
    assert.equal(typeof payload.requestId, 'string')
    assert.ok(payload.requestId.length > 0)
    assert.equal(response.headers['x-request-id'], payload.requestId)
  })

  test('returns standard 404 JSON envelope for unknown POST routes with body', async (t) => {
    // Arrange
    const app = await buildApp(t)
    const nonExistentRoute = randomStringWithPrefix(
      '/api/v1/missing-',
      'abcdefghijklmnopqrstuvwxyz',
      24,
    )

    // Act
    const response = await app.inject({
      method: 'POST',
      url: nonExistentRoute,
      headers: { 'Content-Type': 'application/json' },
      payload: { fakeData: 'should be ignored' },
    })

    // Assert
    assert.equal(response.statusCode, 404)
    const payload = response.json()
    assert.equal(payload.statusCode, 404)
    assert.equal(payload.error, 'Not Found')
    assert.equal(payload.message, 'The requested resource could not be found')
    assert.equal(typeof payload.requestId, 'string')
    assert.equal(response.headers['x-request-id'], payload.requestId)
  })

  test('ignores inbound x-request-id header and emits server-generated canonical requestId', async (t) => {
    // Arrange
    const app = await buildApp(t)
    const nonExistentRoute = randomStringWithPrefix('/', 'abcdefghijklmnopqrstuvwxyz0123456789', 20)
    const inboundRequestId = 'client-controlled-request-id'

    // Act
    const response = await app.inject({
      method: 'GET',
      url: nonExistentRoute,
      headers: {
        'x-request-id': inboundRequestId,
      },
    })

    // Assert
    assert.equal(response.statusCode, 404)
    const payload = response.json()
    assert.equal(typeof payload.requestId, 'string')
    assert.equal(response.headers['x-request-id'], payload.requestId)
    assert.notEqual(payload.requestId, inboundRequestId)
  })
})
