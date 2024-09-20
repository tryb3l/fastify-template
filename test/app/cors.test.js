'use strict'

const { it } = require('node:test')
const { buildApp } = require('../../helper')
const { assert } = require('node:assert')

it('should correctly handle CORS preflight requests', async () => {
  // Arrange
  const app = await buildApp()

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
