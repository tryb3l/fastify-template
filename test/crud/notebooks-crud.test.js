'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { seedUser } = require('../utils/setup-user')

describe('Notebooks CRUD lifecycle', () => {
  test('creates a notebook, reads item and list, updates metadata and status, deletes, and confirms 404', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const headers = { Authorization: `Bearer ${actor.accessToken}` }

    // Create (POST /notebooks)
    const createRes = await actor.app.inject({
      method: 'POST',
      url: '/notebooks',
      headers,
      payload: {
        name: 'Backend Architecture',
        description: 'Fastify & MongoDB patterns',
        mode: 'notebook',
      },
    })
    assert.equal(createRes.statusCode, 201)
    const created = createRes.json().data
    assert.equal(created.name, 'Backend Architecture')
    assert.equal(created.status, 'active')

    // Read item & list (GET /notebooks/:id & GET /notebooks)
    const getRes = await actor.app.inject({
      method: 'GET',
      url: `/notebooks/${created.id}`,
      headers,
    })
    assert.equal(getRes.statusCode, 200)
    assert.equal(getRes.json().data.description, 'Fastify & MongoDB patterns')

    const listRes = await actor.app.inject({
      method: 'GET',
      url: '/notebooks',
      headers,
    })
    assert.equal(listRes.statusCode, 200)
    assert.equal(listRes.json().data.length, 1)
    assert.equal(listRes.json().data[0].id, created.id)

    // Update (PUT /notebooks/:id) and verify persisted changes
    const targetDate = '2026-12-31T00:00:00.000Z'
    const updateRes = await actor.app.inject({
      method: 'PUT',
      url: `/notebooks/${created.id}`,
      headers,
      payload: {
        name: 'System Design Campaign',
        mode: 'campaign',
        status: 'archived',
        targetDate,
      },
    })
    assert.equal(updateRes.statusCode, 200)

    const getUpdatedRes = await actor.app.inject({
      method: 'GET',
      url: `/notebooks/${created.id}`,
      headers,
    })
    assert.equal(getUpdatedRes.statusCode, 200)
    assert.equal(getUpdatedRes.json().data.name, 'System Design Campaign')
    assert.equal(getUpdatedRes.json().data.mode, 'campaign')
    assert.equal(getUpdatedRes.json().data.status, 'archived')
    assert.equal(getUpdatedRes.json().data.targetDate, targetDate)

    // Delete (DELETE /notebooks/:id) and confirm 404
    const deleteRes = await actor.app.inject({
      method: 'DELETE',
      url: `/notebooks/${created.id}`,
      headers,
    })
    assert.equal(deleteRes.statusCode, 204)

    const getDeletedRes = await actor.app.inject({
      method: 'GET',
      url: `/notebooks/${created.id}`,
      headers,
    })
    assert.equal(getDeletedRes.statusCode, 404)
  })
})
