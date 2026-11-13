'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { buildApp } = require('../../../test-setup')

test('GET /health 200 - Returns OK when database is connected and server is healthy', async (t) => {
  // Arrange
  const app = await buildApp(t)

  // Act
  const response = await app.inject({
    method: 'GET',
    url: '/health',
  })

  // Assert
  assert.strictEqual(response.statusCode, 200)

  const payload = response.json()
  assert.strictEqual(payload.status, 'ok')
  assert.strictEqual(payload.database, 'connected')
  assert.ok(payload.memory > 0, 'Should report current memory usage')
})

test('under-pressure plugin calibrates default maxRssBytes above maxHeapUsedBytes and respects env overrides', async (t) => {
  const { resolveUnderPressureThresholds } = require('../../../../plugins/under-pressure')

  const defaults = resolveUnderPressureThresholds({})
  assert.ok(
    defaults.maxRssBytes >= defaults.maxHeapUsedBytes + 350_000_000,
    `Expected maxRssBytes (${defaults.maxRssBytes}) to exceed maxHeapUsedBytes (${defaults.maxHeapUsedBytes}) by at least 350 MB`,
  )

  const overridden = resolveUnderPressureThresholds({
    MAX_HEAP_USED_BYTES: 600_000_000,
    MAX_RSS_BYTES: 1_100_000_000,
  })
  assert.strictEqual(overridden.maxHeapUsedBytes, 600_000_000)
  assert.strictEqual(overridden.maxRssBytes, 1_100_000_000)

  const app = await buildApp(t, {
    MAX_HEAP_USED_BYTES: '800000000',
    MAX_RSS_BYTES: '1300000000',
  })

  const response = await app.inject({
    method: 'GET',
    url: '/health',
  })
  assert.strictEqual(response.statusCode, 200)
})
