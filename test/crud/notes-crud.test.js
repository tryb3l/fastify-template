'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { seedUser } = require('../utils/setup-user')

describe('Notes CRUD lifecycle', () => {
  test('creates a note at revision 1, reads item and list, updates with revision increment, deletes, and confirms 404', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const headers = { Authorization: `Bearer ${actor.accessToken}` }

    // Create (POST /notes)
    const createRes = await actor.app.inject({
      method: 'POST',
      url: '/notes',
      headers,
      payload: {
        title: 'Consensus Notes',
        body: 'Initial Raft summary',
        tags: ['raft', 'paxos'],
        readiness: 'to_review',
        noteType: 'standard',
      },
    })
    assert.equal(createRes.statusCode, 201)
    const created = createRes.json().data
    assert.equal(created.revision, 1)
    assert.equal(created.title, 'Consensus Notes')

    // Read single & list (GET /notes/:id & GET /notes)
    const getRes = await actor.app.inject({
      method: 'GET',
      url: `/notes/${created.id}`,
      headers,
    })
    assert.equal(getRes.statusCode, 200)
    assert.equal(getRes.json().data.body, 'Initial Raft summary')

    const listRes = await actor.app.inject({
      method: 'GET',
      url: '/notes',
      headers,
    })
    assert.equal(listRes.statusCode, 200)
    assert.equal(listRes.json().totalCount, 1)
    assert.equal(listRes.json().data[0].id, created.id)

    // Update (PUT /notes/:id) and verify persisted revision 2
    const updateRes = await actor.app.inject({
      method: 'PUT',
      url: `/notes/${created.id}`,
      headers,
      payload: {
        title: 'Raft & Paxos Notes',
        body: 'Expanded log replication details',
        tags: ['raft', 'consensus'],
        readiness: 'in_progress',
        expectedRevision: 1,
      },
    })
    assert.equal(updateRes.statusCode, 200)
    assert.equal(updateRes.json().data.revision, 2)

    const getUpdatedRes = await actor.app.inject({
      method: 'GET',
      url: `/notes/${created.id}`,
      headers,
    })
    assert.equal(getUpdatedRes.statusCode, 200)
    assert.equal(getUpdatedRes.json().data.title, 'Raft & Paxos Notes')
    assert.equal(getUpdatedRes.json().data.body, 'Expanded log replication details')
    assert.equal(getUpdatedRes.json().data.readiness, 'in_progress')
    assert.equal(getUpdatedRes.json().data.revision, 2)

    // Delete (DELETE /notes/:id?expectedRevision=2) and confirm 404 + empty list
    const deleteRes = await actor.app.inject({
      method: 'DELETE',
      url: `/notes/${created.id}?expectedRevision=2`,
      headers,
    })
    assert.equal(deleteRes.statusCode, 204)

    const getDeletedRes = await actor.app.inject({
      method: 'GET',
      url: `/notes/${created.id}`,
      headers,
    })
    assert.equal(getDeletedRes.statusCode, 404)

    const listAfterDeleteRes = await actor.app.inject({
      method: 'GET',
      url: '/notes',
      headers,
    })
    assert.equal(listAfterDeleteRes.statusCode, 200)
    assert.equal(listAfterDeleteRes.json().totalCount, 0)
  })
})
