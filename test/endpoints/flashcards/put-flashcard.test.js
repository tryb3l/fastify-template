'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUIDv7 } = require('node:crypto')
const { seedUser } = require('../../utils/setup-user')

describe('PUT /flashcards/:id', () => {
  test('returns 200 updating front and back prompts with trimmed values', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const note = await actor.app.notesDataSource.createNote(
      { title: 'Edit Host Note', body: 'text' },
      actor.userId,
    )
    const card = await actor.app.flashcardsDataSource.createFlashcard(
      { noteId: note.id, front: 'Old Front', back: 'Old Back' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'PUT',
      url: `/flashcards/${card.id}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: {
        front: '  Updated Front  ',
        back: '  Updated Back  ',
      },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const updated = response.json().data
    assert.equal(updated.id, card.id)
    assert.equal(updated.front, 'Updated Front')
    assert.equal(updated.back, 'Updated Back')
    assert.equal(updated.box, 1)
  })

  test('returns 200 for partial update of back prompt without altering front or Leitner box', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const note = await actor.app.notesDataSource.createNote(
      { title: 'Partial Host Note', body: 'text' },
      actor.userId,
    )
    const card = await actor.app.flashcardsDataSource.createFlashcard(
      { noteId: note.id, front: 'Kept Front', back: 'Old Back' },
      actor.userId,
    )
    await actor.app.flashcardsDataSource.reviewFlashcard(card.id, 'good', actor.userId)

    // Act
    const response = await actor.app.inject({
      method: 'PUT',
      url: `/flashcards/${card.id}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { back: 'Binary or Fibonacci min-heap' },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const updated = response.json().data
    assert.equal(updated.front, 'Kept Front')
    assert.equal(updated.back, 'Binary or Fibonacci min-heap')
    assert.equal(updated.box, 2)
  })

  test('returns 400 when front or back is whitespace-only', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const note = await actor.app.notesDataSource.createNote(
      { title: 'Blank Check Note', body: 'text' },
      actor.userId,
    )
    const card = await actor.app.flashcardsDataSource.createFlashcard(
      { noteId: note.id, front: 'Valid Front', back: 'Valid Back' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'PUT',
      url: `/flashcards/${card.id}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { back: '    ' },
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 400 when update payload is empty', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const note = await actor.app.notesDataSource.createNote(
      { title: 'Empty Payload Note', body: 'text' },
      actor.userId,
    )
    const card = await actor.app.flashcardsDataSource.createFlashcard(
      { noteId: note.id, front: 'Q', back: 'A' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'PUT',
      url: `/flashcards/${card.id}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: {},
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 400 when flashcard id param is not a valid UUID', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'PUT',
      url: '/flashcards/not-a-uuid',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { front: 'Renamed' },
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
      method: 'PUT',
      url: `/flashcards/${card.id}`,
      payload: { front: 'Unauthorized Edit' },
    })

    // Assert
    assert.equal(response.statusCode, 401)
  })

  test('returns 404 when flashcard does not exist', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'PUT',
      url: `/flashcards/${randomUUIDv7()}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { front: 'Missing Card' },
    })

    // Assert
    assert.equal(response.statusCode, 404)
  })

  test('returns 404 when another user attempts to update the flashcard', async (t) => {
    // Arrange
    const owner = await seedUser(t)
    const intruder = await seedUser(t, { app: owner.app })
    const ownerNote = await owner.app.notesDataSource.createNote(
      { title: 'Owner Note', body: 'secret' },
      owner.userId,
    )
    const ownerCard = await owner.app.flashcardsDataSource.createFlashcard(
      { noteId: ownerNote.id, front: 'Original Q', back: 'Original A' },
      owner.userId,
    )

    // Act
    const response = await intruder.app.inject({
      method: 'PUT',
      url: `/flashcards/${ownerCard.id}`,
      headers: { Authorization: `Bearer ${intruder.accessToken}` },
      payload: { front: 'Hijacked Q' },
    })

    // Assert
    assert.equal(response.statusCode, 404)
    const unchanged = await owner.app.flashcardsDataSource.readFlashcard(ownerCard.id, owner.userId)
    assert.equal(unchanged.front, 'Original Q')
  })
})
