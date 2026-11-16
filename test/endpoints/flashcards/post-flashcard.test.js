'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUIDv7 } = require('node:crypto')
const { seedUser } = require('../../utils/setup-user')

describe('POST /flashcards', () => {
  test('returns 201 and creates a flashcard at box 1 with trimmed prompts, Daily Activity increment, and flashcard_created audit log', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const note = await actor.app.notesDataSource.createNote(
      { title: 'Dijkstra Shortest Path', body: 'Priority queue relaxation' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: '/flashcards',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: {
        noteId: note.id,
        front: '  What data structure gives O((V+E) log V) in Dijkstra?  ',
        back: '  Min-priority queue (binary heap)  ',
      },
    })

    // Assert
    assert.equal(response.statusCode, 201)
    const card = response.json().data
    assert.ok(card.id)
    assert.equal(card.noteId, note.id)
    assert.equal(card.front, 'What data structure gives O((V+E) log V) in Dijkstra?')
    assert.equal(card.back, 'Min-priority queue (binary heap)')
    assert.equal(card.box, 1)
    assert.equal(card.reviewCount, 0)
    assert.equal(card.lapseCount, 0)
    assert.equal(card.lastReviewedAt, null)
    assert.equal(card.lastRating, null)
    assert.ok(!Number.isNaN(Date.parse(card.nextReviewAt)))

    await actor.app.flushAuditLogs()
    const auditDoc = await actor.app.mongo.db
      .collection('auditLogs')
      .findOne({ action: 'flashcard_created', resourceId: card.id })
    assert.ok(auditDoc)

    const summary = await actor.app.dashboardDataSource.getDashboardSummary(actor.userId)
    assert.equal(summary.heatmap12Weeks[83].flashcardsCreated, 1)
  })

  test('returns 400 when front or back is whitespace-only', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const note = await actor.app.notesDataSource.createNote(
      { title: 'Prompt Check', body: 'text' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: '/flashcards',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: {
        noteId: note.id,
        front: '   ',
        back: 'Valid back',
      },
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 400 when required noteId, front, or back field is missing', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: '/flashcards',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { front: 'Question without noteId or back' },
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 400 when front exceeds 2000 characters', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const note = await actor.app.notesDataSource.createNote(
      { title: 'Front Length Bound', body: 'text' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: '/flashcards',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: {
        noteId: note.id,
        front: 'q'.repeat(2_001),
        back: 'Valid answer',
      },
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 400 when back exceeds 5000 characters', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const note = await actor.app.notesDataSource.createNote(
      { title: 'Back Length Bound', body: 'text' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: '/flashcards',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: {
        noteId: note.id,
        front: 'Valid question',
        back: 'a'.repeat(5_001),
      },
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 401 when unauthenticated', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const note = await actor.app.notesDataSource.createNote(
      { title: 'Protected Note', body: 'text' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: '/flashcards',
      payload: {
        noteId: note.id,
        front: 'Unauthorized front',
        back: 'Unauthorized back',
      },
    })

    // Assert
    assert.equal(response.statusCode, 401)
  })

  test('returns 404 when parent note does not exist', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: '/flashcards',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: {
        noteId: randomUUIDv7(),
        front: 'Orphan question',
        back: 'Orphan answer',
      },
    })

    // Assert
    assert.equal(response.statusCode, 404)
  })

  test('returns 404 when another user attempts to attach a flashcard to the note', async (t) => {
    // Arrange
    const owner = await seedUser(t)
    const intruder = await seedUser(t, { app: owner.app })
    const ownerNote = await owner.app.notesDataSource.createNote(
      { title: 'Owner Note', body: 'private' },
      owner.userId,
    )

    // Act
    const response = await intruder.app.inject({
      method: 'POST',
      url: '/flashcards',
      headers: { Authorization: `Bearer ${intruder.accessToken}` },
      payload: {
        noteId: ownerNote.id,
        front: 'IDOR front',
        back: 'IDOR back',
      },
    })

    // Assert
    assert.equal(response.statusCode, 404)
  })
})
