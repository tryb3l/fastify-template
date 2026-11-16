'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { seedUser } = require('../utils/setup-user')

describe('Flashcards CRUD lifecycle', () => {
  test('creates a flashcard on a note, reads item and list, updates prompts, deletes, and confirms 404', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const headers = { Authorization: `Bearer ${actor.accessToken}` }
    const note = await actor.app.notesDataSource.createNote(
      { title: 'Node.js Event Loop', body: 'libuv phases' },
      actor.userId,
    )

    // Create (POST /flashcards)
    const createRes = await actor.app.inject({
      method: 'POST',
      url: '/flashcards',
      headers,
      payload: {
        noteId: note.id,
        front: 'Which phase executes timers?',
        back: 'timers phase',
      },
    })
    assert.equal(createRes.statusCode, 201)
    const created = createRes.json().data
    assert.equal(created.box, 1)
    assert.equal(created.noteId, note.id)

    // Read item & list (GET /flashcards/:id & GET /flashcards?noteId=...)
    const getRes = await actor.app.inject({
      method: 'GET',
      url: `/flashcards/${created.id}`,
      headers,
    })
    assert.equal(getRes.statusCode, 200)
    assert.equal(getRes.json().data.front, 'Which phase executes timers?')

    const listRes = await actor.app.inject({
      method: 'GET',
      url: `/flashcards?noteId=${note.id}`,
      headers,
    })
    assert.equal(listRes.statusCode, 200)
    assert.equal(listRes.json().data.length, 1)
    assert.equal(listRes.json().data[0].id, created.id)

    // Update (PUT /flashcards/:id) and verify persisted prompts
    const updateRes = await actor.app.inject({
      method: 'PUT',
      url: `/flashcards/${created.id}`,
      headers,
      payload: {
        front: 'Which libuv phase runs setTimeout and setInterval callbacks?',
        back: 'The timers phase at the start of the loop iteration.',
      },
    })
    assert.equal(updateRes.statusCode, 200)

    const getUpdatedRes = await actor.app.inject({
      method: 'GET',
      url: `/flashcards/${created.id}`,
      headers,
    })
    assert.equal(getUpdatedRes.statusCode, 200)
    assert.equal(
      getUpdatedRes.json().data.front,
      'Which libuv phase runs setTimeout and setInterval callbacks?',
    )
    assert.equal(
      getUpdatedRes.json().data.back,
      'The timers phase at the start of the loop iteration.',
    )

    // Delete (DELETE /flashcards/:id) and confirm 404 + empty list
    const deleteRes = await actor.app.inject({
      method: 'DELETE',
      url: `/flashcards/${created.id}`,
      headers,
    })
    assert.equal(deleteRes.statusCode, 204)

    const getDeletedRes = await actor.app.inject({
      method: 'GET',
      url: `/flashcards/${created.id}`,
      headers,
    })
    assert.equal(getDeletedRes.statusCode, 404)

    const listAfterDeleteRes = await actor.app.inject({
      method: 'GET',
      url: `/flashcards?noteId=${note.id}`,
      headers,
    })
    assert.equal(listAfterDeleteRes.statusCode, 200)
    assert.deepEqual(listAfterDeleteRes.json().data, [])
  })
})
