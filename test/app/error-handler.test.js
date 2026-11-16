'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const Fastify = require('fastify')

const errorHandlerPlugin = require('../../plugins/error-handler')
const { randomPassword } = require('../utils/data-creator')
const { seedUser } = require('../utils/setup-user')

describe('Error handler plugin', () => {
  test('masks unhandled 500 error details and attaches canonical requestId', async (t) => {
    // Arrange
    const app = Fastify({ logger: false })
    t.after(async () => {
      await app.close()
    })
    await app.register(errorHandlerPlugin)
    app.get('/boom', async () => {
      throw new Error('mongodb://internal-secret:password@cluster.local/prod crashed')
    })

    // Act
    const response = await app.inject({
      method: 'GET',
      url: '/boom',
    })

    // Assert
    assert.equal(response.statusCode, 500)
    const payload = response.json()
    assert.equal(payload.statusCode, 500)
    assert.equal(payload.message, 'Fatal error. Contact the support team.')
    assert.equal(typeof payload.requestId, 'string')
    assert.equal(response.headers['x-request-id'], payload.requestId)
    assert.ok(!JSON.stringify(payload).includes('internal-secret'))
    assert.ok(!JSON.stringify(payload).includes('mongodb://'))
  })

  test('formats 409 conflicts with conflictCode and optional revision metadata', async (t) => {
    // Arrange
    const app = Fastify({ logger: false })
    t.after(async () => {
      await app.close()
    })
    await app.register(errorHandlerPlugin)

    const modifiedAt = new Date('2026-05-01T12:00:00.000Z')
    app.get('/conflict-plain', async () => {
      const err = new Error('Notebook is not empty')
      err.statusCode = 409
      err.conflictCode = 'NOTEBOOK_NOT_EMPTY'
      throw err
    })
    app.get('/conflict-stale', async () => {
      const err = new Error('Note modified concurrently')
      err.statusCode = 409
      err.conflictCode = 'NOTE_STALE_SAVE'
      err.currentRevision = 4
      err.currentModifiedAt = modifiedAt
      throw err
    })

    // Act
    const plainRes = await app.inject({ method: 'GET', url: '/conflict-plain' })
    const staleRes = await app.inject({ method: 'GET', url: '/conflict-stale' })

    // Assert
    assert.equal(plainRes.statusCode, 409)
    assert.deepEqual(plainRes.json(), {
      message: 'Notebook is not empty',
      code: 'NOTEBOOK_NOT_EMPTY',
    })

    assert.equal(staleRes.statusCode, 409)
    assert.deepEqual(staleRes.json(), {
      message: 'Note modified concurrently',
      code: 'NOTE_STALE_SAVE',
      currentRevision: 4,
      currentModifiedAt: '2026-05-01T12:00:00.000Z',
    })
  })

  test('formats 410 syncCode and 400 schema validation envelopes consistently', async (t) => {
    // Arrange
    const app = Fastify({ logger: false })
    t.after(async () => {
      await app.close()
    })
    await app.register(errorHandlerPlugin)

    app.get('/sync-expired', async () => {
      const err = new Error('Sync cursor expired')
      err.statusCode = 410
      err.syncCode = 'SYNC_CURSOR_EXPIRED'
      throw err
    })
    app.post(
      '/validated',
      {
        schema: {
          body: {
            type: 'object',
            required: ['title'],
            properties: { title: { type: 'string' } },
          },
        },
      },
      async () => ({ ok: true }),
    )

    // Act
    const syncRes = await app.inject({ method: 'GET', url: '/sync-expired' })
    const validationRes = await app.inject({
      method: 'POST',
      url: '/validated',
      payload: {},
    })

    // Assert
    assert.equal(syncRes.statusCode, 410)
    assert.deepEqual(syncRes.json(), {
      message: 'Sync cursor expired',
      code: 'SYNC_CURSOR_EXPIRED',
    })

    assert.equal(validationRes.statusCode, 400)
    const validationBody = validationRes.json()
    assert.equal(validationBody.statusCode, 400)
    assert.equal(validationBody.message, 'Validation failed')
    assert.equal(typeof validationBody.requestId, 'string')
    assert.ok(Array.isArray(validationBody.details))
    assert.ok(validationBody.details.length > 0)
  })

  test('sanitizes unexpected 500 failures from full app routes when stored password hash is corrupt', async (t) => {
    // Arrange
    const { app, username } = await seedUser(t)
    await app.mongo.db
      .collection('users')
      .updateOne({ username }, { $set: { hash: 'corrupt-non-argon2-hash' } })

    // Act
    const response = await app.inject({
      method: 'POST',
      url: '/auth/authenticate',
      payload: {
        username,
        password: randomPassword(),
      },
    })

    // Assert
    assert.equal(response.statusCode, 500)
    const payload = response.json()
    assert.equal(payload.statusCode, 500)
    assert.equal(payload.message, 'Fatal error. Contact the support team.')
    assert.equal(typeof payload.requestId, 'string')
    assert.equal(response.headers['x-request-id'], payload.requestId)
    assert.ok(!JSON.stringify(payload).includes('corrupt-non-argon2-hash'))
  })
})
