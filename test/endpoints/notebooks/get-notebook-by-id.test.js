'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUIDv7 } = require('node:crypto')
const { seedUser } = require('../../utils/setup-user')

describe('GET /notebooks/:id', () => {
  test('returns 200 with normalized notebook metadata including campaign targetDate', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const targetDate = '2026-11-01T00:00:00.000Z'
    const campaign = await actor.app.notebooksDataSource.createNotebook(
      {
        name: 'Cloudflare Interview Campaign',
        description: 'Edge networking & Workers',
        mode: 'campaign',
        status: 'active',
        targetDate,
      },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: `/notebooks/${campaign.id}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const { data } = response.json()
    assert.equal(data.id, campaign.id)
    assert.equal(data.name, 'Cloudflare Interview Campaign')
    assert.equal(data.description, 'Edge networking & Workers')
    assert.equal(data.mode, 'campaign')
    assert.equal(data.status, 'active')
    assert.equal(data.targetDate, targetDate)
    assert.equal(Object.hasOwn(data, '_id'), false)
    assert.equal(Object.hasOwn(data, 'userId'), false)
  })

  test('returns 400 when notebook id param is not a valid UUID', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: '/notebooks/not-a-uuid',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 401 when unauthenticated', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const notebook = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Protected NB' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: `/notebooks/${notebook.id}`,
    })

    // Assert
    assert.equal(response.statusCode, 401)
  })

  test('returns 404 when notebook does not exist', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: `/notebooks/${randomUUIDv7()}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 404)
  })

  test('returns 404 when another user attempts to read the notebook', async (t) => {
    // Arrange
    const owner = await seedUser(t)
    const intruder = await seedUser(t, { app: owner.app })
    const privateNotebook = await owner.app.notebooksDataSource.createNotebook(
      { name: 'Private NB' },
      owner.userId,
    )

    // Act
    const response = await intruder.app.inject({
      method: 'GET',
      url: `/notebooks/${privateNotebook.id}`,
      headers: { Authorization: `Bearer ${intruder.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 404)
  })
})
