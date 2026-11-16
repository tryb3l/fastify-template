'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { buildApp } = require('../test-setup')
const { seedUser } = require('../utils/setup-user')

describe('Rate limiting plugin', () => {
  test('blocks authenticated user after exceeding route max and isolates buckets per user', async (t) => {
    // Arrange
    const userA = await seedUser(t)
    const userB = await seedUser(t, { app: userA.app })

    // Act: exhaust User A's 5-request test bucket on GET /notes
    for (let i = 0; i < 5; i += 1) {
      const res = await userA.app.inject({
        method: 'GET',
        url: '/notes',
        headers: { Authorization: `Bearer ${userA.accessToken}` },
      })
      assert.equal(res.statusCode, 200, `Request ${i + 1} for user A should succeed`)
    }

    const blockedResponse = await userA.app.inject({
      method: 'GET',
      url: '/notes',
      headers: { Authorization: `Bearer ${userA.accessToken}` },
    })
    const userBResponse = await userA.app.inject({
      method: 'GET',
      url: '/notes',
      headers: { Authorization: `Bearer ${userB.accessToken}` },
    })

    // Assert
    assert.equal(blockedResponse.statusCode, 429)
    const payload = blockedResponse.json()
    assert.equal(payload.statusCode, 429)
    assert.equal(payload.error, 'Too Many Requests')
    assert.ok(payload.message.includes('Slow down please!'))
    assert.equal(typeof payload.requestId, 'string')
    assert.equal(userBResponse.statusCode, 200)
  })

  test('blocks unauthenticated requests by IP after exceeding route max', async (t) => {
    // Arrange
    const app = await buildApp(t)

    for (let i = 0; i < 3; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/reset-password/request',
        payload: { email: `nobody-${i}@example.com` },
      })
      assert.equal(res.statusCode, 200, `IP request ${i + 1} should succeed`)
    }

    // Act
    const blockedResponse = await app.inject({
      method: 'POST',
      url: '/auth/reset-password/request',
      payload: { email: 'nobody-over@example.com' },
    })

    // Assert
    assert.equal(blockedResponse.statusCode, 429)
    const payload = blockedResponse.json()
    assert.equal(payload.statusCode, 429)
    assert.equal(payload.error, 'Too Many Requests')
    assert.ok(payload.message.includes('Slow down please!'))
    assert.equal(typeof payload.requestId, 'string')
  })
})
