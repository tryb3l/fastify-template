'use strict'

const { test } = require('node:test')
const { buildApp } = require('../helper')
const { assert } = require('node:assert')

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
