'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { buildApp } = require('../test-setup')
const { randomStringWithPrefix } = require('../utils/data-creator')

test('GET / 200 - default root route', async (t) => {
  // Arrange
  const app = await buildApp(t)

  // Act
  const res = await app.inject({
    url: '/',
  })

  // Assert
  assert.strictEqual(res.statusCode, 200)
  assert.deepStrictEqual(res.json(), { root: true })
})

test('GET random path 404 - non-existent route returns 404', async (t) => {
  // Arrange
  const app = await buildApp(t)
  const nonExistentRoute = randomStringWithPrefix('/', 'abcdefghijklmnopqrstuvwxyz0123456789', 30)

  // Act
  const res = await app.inject({
    url: nonExistentRoute,
  })

  // Assert
  assert.strictEqual(res.statusCode, 404)

  const payload = res.json()
  assert.strictEqual(payload.statusCode, 404)
  assert.strictEqual(payload.error, 'Not Found')
  assert.strictEqual(payload.message, 'The requested resource could not be found')
  assert.strictEqual(typeof payload.requestId, 'string')
})