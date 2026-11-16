'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { buildApp } = require('../../test-setup')

describe('GET /infrastructure/ready', () => {
  test('returns 200 ok without authentication', async (t) => {
    // Arrange
    const app = await buildApp(t)

    // Act
    const response = await app.inject({
      method: 'GET',
      url: '/infrastructure/ready',
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.deepEqual(response.json(), { status: 'ok' })
  })
})
