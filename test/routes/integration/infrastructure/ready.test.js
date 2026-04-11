'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { buildApp } = require('../../../helper')

test('GET /infrastructure/ready 200 - Returns OK without authentication', async (t) => {
  // Arrange
  const app = await buildApp(t)

  // Act
  const response = await app.inject({
    method: 'GET',
    url: '/infrastructure/ready',
  })

  // Assert
  assert.strictEqual(response.statusCode, 200)
  assert.deepStrictEqual(response.json(), { status: 'ok' })
})