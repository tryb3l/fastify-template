'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { seedUser } = require('../utils/setup-user')

describe('createNotes store boundary', () => {
  test('returns empty array when noteList is empty and validates container placement', async (t) => {
    const actor = await seedUser(t)
    const store = actor.app.notesDataSource.forUser(actor.userId)

    // Should return []
    const result = await store.createNotes([])
    assert.deepEqual(result, [])

    // Should validate container placement even if empty
    await assert.rejects(store.createNotes([], { notebookId: 'invalid-id' }), /Notebook not found/)
  })

  test('ignores provided identity and tenant fields, sets them correctly, and prevents arbitrary extra keys', async (t) => {
    const actor = await seedUser(t)
    const store = actor.app.notesDataSource.forUser(actor.userId)
    const rawNoteList = [
      {
        _id: 'clobber-me',
        id: 'clobber-me-too',
        userId: 'some-other-user',
        revision: 99,
        title: 'Hacked Note',
        body: 'Content',
        tags: ['hack'],
        readiness: 'mastered',
        noteType: 'post_mortem',
        unknownField: 'bad-data',
      },
    ]

    const resultIds = await store.createNotes(rawNoteList)
    assert.equal(resultIds.length, 1)

    // Ensure the returned ID is the generated one, not the clobber attempt
    const newId = resultIds[0]
    assert.notEqual(newId, 'clobber-me-too')
    assert.notEqual(newId, 'clobber-me')

    // Read directly from DB to inspect all fields including _id and missing ones
    const dbNote = await actor.app.mongo.db.collection('notes').findOne({ id: newId })

    assert.equal(dbNote._id, newId)
    assert.equal(dbNote.id, newId)
    assert.equal(dbNote.userId, actor.userId)
    assert.equal(dbNote.revision, 1)
    assert.equal(dbNote.title, 'Hacked Note')
    assert.equal(dbNote.unknownField, undefined)
  })

  test('normalizes tags and attachments to arrays if provided as non-arrays', async (t) => {
    const actor = await seedUser(t)
    const store = actor.app.notesDataSource.forUser(actor.userId)
    const rawNoteList = [
      {
        title: 'Note 1',
        body: 'Content',
        tags: 'not-an-array',
        attachments: null,
      },
      {
        title: 'Note 2',
        body: 'Content',
        tags: null,
        attachments: 'not-an-array',
      },
    ]

    const resultIds = await store.createNotes(rawNoteList)
    assert.equal(resultIds.length, 2)

    const dbNote1 = await actor.app.mongo.db.collection('notes').findOne({ id: resultIds[0] })
    assert.deepEqual(dbNote1.tags, [])
    assert.deepEqual(dbNote1.attachments, [])

    const dbNote2 = await actor.app.mongo.db.collection('notes').findOne({ id: resultIds[1] })
    assert.deepEqual(dbNote2.tags, [])
    assert.deepEqual(dbNote2.attachments, [])
  })
})

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
