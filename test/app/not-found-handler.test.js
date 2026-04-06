'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { buildApp } = require('../helper')
const { randomStringWithPrefix } = require('../utils/data-creator')

test('GET request to a non-existent route returns standard 404 JSON', async (t) => {
  // Arrange
  const app = await buildApp(t)
  const nonExistentRoute = randomStringWithPrefix('/', 'abcdefghijklmnopqrstuvwxyz', 20)

  // Act
  const response = await app.inject({
    method: 'GET',
    url: nonExistentRoute,
  })

  // Assert
  assert.strictEqual(response.statusCode, 404)

  const payload = response.json()
  assert.strictEqual(payload.statusCode, 404)
  assert.strictEqual(payload.error, 'Not Found')
  assert.strictEqual(payload.message, 'The requested resource could not be found')
  assert.strictEqual(typeof payload.requestId, 'string')
})

test('POST request with payload to a non-existent route returns standard 404 JSON', async (t) => {
  // Arrange
  const app = await buildApp(t)
  const nonExistentRoute = randomStringWithPrefix('/api/v1/missing-', 'abcdefghijklmnopqrstuvwxyz', 24)

  // Act
  const response = await app.inject({
    method: 'POST',
    url: nonExistentRoute,
    headers: { 'Content-Type': 'application/json' },
    payload: { fakeData: 'should be ignored' }
  })

  // Assert
  assert.strictEqual(response.statusCode, 404)

  const payload = response.json()
  assert.strictEqual(payload.statusCode, 404)
  assert.strictEqual(payload.error, 'Not Found')
  assert.strictEqual(payload.message, 'The requested resource could not be found')
  assert.strictEqual(typeof payload.requestId, 'string')
})