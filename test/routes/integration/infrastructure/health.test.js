'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { buildApp } = require('../../../helper')

test('GET /health 200 - Returns OK when database is connected and server is healthy', async (t) => {
    // Arrange
    const app = await buildApp(t)

    // Act
    const response = await app.inject({
        method: 'GET',
        url: '/health'
    })

    // Assert
    assert.strictEqual(response.statusCode, 200)

    const payload = response.json()
    assert.strictEqual(payload.status, 'ok')
    assert.strictEqual(payload.database, 'connected')
    assert.ok(payload.memory > 0, 'Should report current memory usage')
})