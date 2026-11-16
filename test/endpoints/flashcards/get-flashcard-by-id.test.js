'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUIDv7 } = require('node:crypto')
const { seedUser } = require('../../utils/setup-user')

describe('GET /flashcards/:id', () => {
  test('returns 200 with normalized flashcard details excluding internal fields', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const note = await actor.app.notesDataSource.createNote(
      { title: 'Card Owner Note', body: 'content' },
      actor.userId,
    )
    const created = await actor.app.flashcardsDataSource.createFlashcard(
      {
        noteId: note.id,
        front: 'Can Dijkstra handle negative edge weights?',
        back: 'No, use Bellman-Ford',
      },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: `/flashcards/${created.id}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const { data } = response.json()
    assert.equal(data.id, created.id)
    assert.equal(data.noteId, note.id)
    assert.equal(data.front, 'Can Dijkstra handle negative edge weights?')
    assert.equal(data.back, 'No, use Bellman-Ford')
    assert.equal(data.box, 1)
    assert.equal(Object.hasOwn(data, '_id'), false)
    assert.equal(Object.hasOwn(data, 'userId'), false)
  })

  test('returns 400 when flashcard id param is not a valid UUID', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: '/flashcards/not-a-uuid',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 401 when unauthenticated', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const note = await actor.app.notesDataSource.createNote(
      { title: 'Note', body: 'text' },
      actor.userId,
    )
    const card = await actor.app.flashcardsDataSource.createFlashcard(
      { noteId: note.id, front: 'Q', back: 'A' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: `/flashcards/${card.id}`,
    })

    // Assert
    assert.equal(response.statusCode, 401)
  })

  test('returns 404 when flashcard does not exist', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: `/flashcards/${randomUUIDv7()}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 404)
  })

  test('returns 404 when another user attempts to read the flashcard', async (t) => {
    // Arrange
    const owner = await seedUser(t)
    const intruder = await seedUser(t, { app: owner.app })
    const ownerNote = await owner.app.notesDataSource.createNote(
      { title: 'Owner Note', body: 'secret' },
      owner.userId,
    )
    const ownerCard = await owner.app.flashcardsDataSource.createFlashcard(
      { noteId: ownerNote.id, front: 'Private Q', back: 'Private A' },
      owner.userId,
    )

    // Act
    const response = await intruder.app.inject({
      method: 'GET',
      url: `/flashcards/${ownerCard.id}`,
      headers: { Authorization: `Bearer ${intruder.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 404)
  })
})
