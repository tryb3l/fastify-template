'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { buildApp } = require('../../test-setup')

describe('GET /health', () => {
  test('returns 200 with connected database and memory payload', async (t) => {
    // Arrange
    const app = await buildApp(t)

    // Act
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const payload = response.json()
    assert.equal(payload.status, 'ok')
    assert.equal(payload.database, 'connected')
    assert.equal(typeof payload.memory, 'number')
    assert.ok(payload.memory > 0)
  })
})
