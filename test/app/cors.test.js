'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { buildApp } = require('../test-setup')

describe('CORS plugin', () => {
  test('exposes x-request-id header for allowed browser origins', async (t) => {
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
    assert.equal(response.statusCode, 200)
    assert.equal(response.headers['access-control-allow-origin'], 'http://localhost:5173')
    assert.equal(response.headers['access-control-allow-credentials'], 'true')
    assert.ok(response.headers['access-control-expose-headers'].includes('x-request-id'))
    assert.equal(typeof response.headers['x-request-id'], 'string')
  })

  test('handles CORS preflight OPTIONS requests for allowed origins', async (t) => {
    // Arrange
    const app = await buildApp(t)

    // Act
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Content-Type, Authorization',
      },
    })

    // Assert
    assert.equal(response.statusCode, 204)
    assert.equal(response.headers['access-control-allow-origin'], 'http://localhost:5173')
    assert.equal(response.headers['access-control-allow-methods'], 'GET, POST, PUT, DELETE')
  })

  test('omits allow-origin header for disallowed browser origins', async (t) => {
    // Arrange
    const app = await buildApp(t)

    // Act
    const response = await app.inject({
      method: 'GET',
      url: '/',
      headers: {
        Origin: 'http://disallowed.example.com',
      },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.equal(response.headers['access-control-allow-origin'], undefined)
  })
})
