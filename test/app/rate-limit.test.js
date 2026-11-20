'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { buildApp } = require('../test-setup')
const { seedUser } = require('../utils/setup-user')

describe('Rate limiting plugin', () => {
  test('rateLimitPlugin explicitly requires authentication-plugin', async (t) => {
    const Fastify = require('fastify')
    const configPlugin = require('../../plugins/config')
    const rateLimitPlugin = require('../../plugins/rate-limit')

    const app = Fastify({ logger: false })
    t.after(() => app.close().catch(() => {}))

    app.register(configPlugin, {
      configData: {
        MONGO_URL: 'mongodb://localhost:27017/test',
        NODE_ENV: 'test',
        JWT_SECRET: 'secret-11111111',
        COOKIE_SECRET: 'cookie-secret-11111111',
        FRONTEND_URL: 'http://localhost:5173',
      },
    })

    await assert.rejects(async () => {
      await app.register(rateLimitPlugin)
    }, /The dependency 'authentication-plugin' of plugin 'rate-limit' is not registered/)
  })

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

  test('shares IP bucket across alternating authenticated and unauthenticated requests on public routes', async (t) => {
    // Arrange
    const user = await seedUser(t)

    // Act: 1 request with token
    const res1 = await user.app.inject({
      method: 'POST',
      url: '/auth/reset-password/request',
      headers: { Authorization: `Bearer ${user.accessToken}` },
      payload: { email: 'test1@example.com' },
    })
    assert.equal(res1.statusCode, 200, 'Authenticated request 1 should succeed')

    // Act: 2 request without token
    const res2 = await user.app.inject({
      method: 'POST',
      url: '/auth/reset-password/request',
      payload: { email: 'test2@example.com' },
    })
    assert.equal(res2.statusCode, 200, 'Unauthenticated request 2 should succeed')

    // Act: 3 request with token
    const res3 = await user.app.inject({
      method: 'POST',
      url: '/auth/reset-password/request',
      headers: { Authorization: `Bearer ${user.accessToken}` },
      payload: { email: 'test3@example.com' },
    })
    assert.equal(res3.statusCode, 200, 'Authenticated request 3 should succeed')

    // Act: 4 request without token should hit 429
    const res4 = await user.app.inject({
      method: 'POST',
      url: '/auth/reset-password/request',
      payload: { email: 'test4@example.com' },
    })
    assert.equal(res4.statusCode, 429, 'Request 4 should be rate limited')
  })

  test('enforces rate limit on POST /users/invites to prevent outbound invite spam', async (t) => {
    // Arrange
    const admin = await seedUser(t, { role: 'admin' })

    // Act: exhaust admin's 10-request test bucket on POST /users/invites
    for (let i = 0; i < 10; i += 1) {
      const res = await admin.app.inject({
        method: 'POST',
        url: '/users/invites',
        headers: { Authorization: `Bearer ${admin.accessToken}` },
        payload: {},
      })
      assert.equal(res.statusCode, 201, `Invite request ${i + 1} should succeed`)
    }

    const blockedResponse = await admin.app.inject({
      method: 'POST',
      url: '/users/invites',
      headers: { Authorization: `Bearer ${admin.accessToken}` },
      payload: {},
    })

    // Assert
    assert.equal(blockedResponse.statusCode, 429)
    assert.equal(blockedResponse.json().error, 'Too Many Requests')
  })

  test('attaches per-user rate-limit headers on GET /dashboard/summary and GET /files/export', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const dashboardRes = await actor.app.inject({
      method: 'GET',
      url: '/dashboard/summary',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })
    const exportRes = await actor.app.inject({
      method: 'GET',
      url: '/files/export',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(dashboardRes.statusCode, 200)
    assert.equal(dashboardRes.headers['x-ratelimit-limit'], '60')
    assert.equal(exportRes.statusCode, 200)
    assert.equal(exportRes.headers['x-ratelimit-limit'], '60')
  })
})
