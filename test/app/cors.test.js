'use strict'

const { test } = require('node:test')
const { buildApp } = require('../test-setup')
const assert = require('node:assert')

test('should expose the request id header for allowed browser origins', async (t) => {
  // Arrange
  const app = await buildApp(t)

  // Act
  const response = await app.inject({
    method: 'GET',
    url: '/',
    headers: {
      Origin: 'http://localhost:5173',
    },
  })

  // Assert
  assert.strictEqual(response.statusCode, 200)
  assert.strictEqual(response.headers['access-control-allow-origin'], 'http://localhost:5173')
  assert.ok(response.headers['access-control-expose-headers'].includes('x-request-id'))
  assert.strictEqual(typeof response.headers['x-request-id'], 'string')
})

test.skip('should correctly handle CORS preflight requests', async (t) => {
  // Arrange
  const app = await buildApp(t)

  // Act
  const response = await app.inject({
    method: 'OPTIONS',
    url: '/',
    headers: {
      Origin: 'http://example.com',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'Content-Type',
    },
  })

  // Assert
  assert.strictEqual(response.statusCode, 204)
  assert.strictEqual(response.headers['access-control-allow-methods'], 'GET, POST, PUT, DELETE')
})
