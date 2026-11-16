'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUIDv7 } = require('node:crypto')
const { seedUser } = require('../../utils/setup-user')

describe('DELETE /flashcards/:id', () => {
  test('returns 204, deletes the flashcard, records a sync tombstone, and writes flashcard_deleted audit log', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const note = await actor.app.notesDataSource.createNote(
      { title: 'Delete Host Note', body: 'text' },
      actor.userId,
    )
    const card = await actor.app.flashcardsDataSource.createFlashcard(
      { noteId: note.id, front: 'Delete Q', back: 'Delete A' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'DELETE',
      url: `/flashcards/${card.id}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 204)
    assert.equal(response.body, '')

    await assert.rejects(
      () => actor.app.flashcardsDataSource.readFlashcard(card.id, actor.userId),
      {
        statusCode: 404,
      },
    )

    const tombstone = await actor.app.mongo.db
      .collection('syncTombstones')
      .findOne({ userId: actor.userId, entityType: 'flashcard', entityId: card.id })
    assert.ok(tombstone)

    await actor.app.flushAuditLogs()
    const auditDoc = await actor.app.mongo.db
      .collection('auditLogs')
      .findOne({ action: 'flashcard_deleted', resourceId: card.id })
    assert.ok(auditDoc)
  })

  test('returns 400 when flashcard id param is not a valid UUID', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'DELETE',
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
      method: 'DELETE',
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
      method: 'DELETE',
      url: `/flashcards/${randomUUIDv7()}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 404)
  })

  test('returns 404 when another user attempts to delete the flashcard', async (t) => {
    // Arrange
    const owner = await seedUser(t)
    const intruder = await seedUser(t, { app: owner.app })
    const ownerNote = await owner.app.notesDataSource.createNote(
      { title: 'Owner Note', body: 'secret' },
      owner.userId,
    )
    const ownerCard = await owner.app.flashcardsDataSource.createFlashcard(
      { noteId: ownerNote.id, front: 'Protected Q', back: 'Protected A' },
      owner.userId,
    )

    // Act
    const response = await intruder.app.inject({
      method: 'DELETE',
      url: `/flashcards/${ownerCard.id}`,
      headers: { Authorization: `Bearer ${intruder.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 404)
    const stillExists = await owner.app.flashcardsDataSource.readFlashcard(
      ownerCard.id,
      owner.userId,
    )
    assert.equal(stillExists.id, ownerCard.id)
  })
})
