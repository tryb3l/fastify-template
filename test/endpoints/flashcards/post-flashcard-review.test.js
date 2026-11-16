'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUIDv7 } = require('node:crypto')
const { seedUser } = require('../../utils/setup-user')

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000

function assertIntervalApproxMs(
  reviewedAtIso,
  nextReviewAtIso,
  expectedDeltaMs,
  toleranceMs = 5_000,
) {
  const actualDeltaMs = Date.parse(nextReviewAtIso) - Date.parse(reviewedAtIso)
  assert.ok(
    Math.abs(actualDeltaMs - expectedDeltaMs) <= toleranceMs,
    `Expected interval ~${expectedDeltaMs}ms, got ${actualDeltaMs}ms`,
  )
}

describe('POST /flashcards/:id/review', () => {
  test('returns 200 advancing box 1 to 2 (+3d) on good rating and promoting parent Note from to_review to in_progress', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const note = await actor.app.notesDataSource.createNote(
      { title: 'Event Loop Phases', body: 'timers, poll, check', readiness: 'to_review' },
      actor.userId,
    )
    const card = await actor.app.flashcardsDataSource.createFlashcard(
      { noteId: note.id, front: 'setImmediate phase?', back: 'check phase' },
      actor.userId,
    )
    await actor.app.notesDataSource.readNote(note.id, actor.userId)
    assert.ok(await actor.app.cacheGet(`note:${note.id}:${actor.userId}`))

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: `/flashcards/${card.id}/review`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { rating: 'good' },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const { flashcard, noteReadiness } = response.json().data
    assert.equal(flashcard.box, 2)
    assert.equal(flashcard.reviewCount, 1)
    assert.equal(flashcard.lapseCount, 0)
    assert.equal(flashcard.lastRating, 'good')
    assertIntervalApproxMs(flashcard.lastReviewedAt, flashcard.nextReviewAt, 3 * DAY_MS)
    assert.equal(noteReadiness, 'in_progress')

    // Cache on parent Note is invalidated when readiness mutates
    assert.equal(await actor.app.cacheGet(`note:${note.id}:${actor.userId}`), null)
    const updatedParent = await actor.app.notesDataSource.readNote(note.id, actor.userId)
    assert.equal(updatedParent.readiness, 'in_progress')
    assert.equal(updatedParent.revision, 2)
  })

  test('returns 200 advancing box 2 to 3 (+7d) on good rating', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const note = await actor.app.notesDataSource.createNote(
      { title: 'Box 3 Step', body: 'text' },
      actor.userId,
    )
    const card = await actor.app.flashcardsDataSource.createFlashcard(
      { noteId: note.id, front: 'Q', back: 'A' },
      actor.userId,
    )
    await actor.app.flashcardsDataSource.reviewFlashcard(card.id, 'good', actor.userId) // -> box 2

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: `/flashcards/${card.id}/review`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { rating: 'good' },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const { flashcard } = response.json().data
    assert.equal(flashcard.box, 3)
    assertIntervalApproxMs(flashcard.lastReviewedAt, flashcard.nextReviewAt, 7 * DAY_MS)
  })

  test('returns 200 advancing to box 4 (+14d) and auto-promoting parent Note to mastered when all Note cards reach box >= 4', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const note = await actor.app.notesDataSource.createNote(
      { title: 'Mastery Coupling', body: 'text' },
      actor.userId,
    )
    const cardA = await actor.app.flashcardsDataSource.createFlashcard(
      { noteId: note.id, front: 'QA', back: 'AA' },
      actor.userId,
    )
    const cardB = await actor.app.flashcardsDataSource.createFlashcard(
      { noteId: note.id, front: 'QB', back: 'AB' },
      actor.userId,
    )
    // Advance cardA to box 4 (1->2->3->4) and cardB to box 3 (1->2->3)
    for (let step = 0; step < 3; step += 1) {
      await actor.app.flashcardsDataSource.reviewFlashcard(cardA.id, 'good', actor.userId)
    }
    for (let step = 0; step < 2; step += 1) {
      await actor.app.flashcardsDataSource.reviewFlashcard(cardB.id, 'good', actor.userId)
    }

    // Act — advancing cardB from box 3 to box 4 brings every card on the Note to box >= 4
    const response = await actor.app.inject({
      method: 'POST',
      url: `/flashcards/${cardB.id}/review`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { rating: 'good' },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const { flashcard, noteReadiness } = response.json().data
    assert.equal(flashcard.box, 4)
    assertIntervalApproxMs(flashcard.lastReviewedAt, flashcard.nextReviewAt, 14 * DAY_MS)
    assert.equal(noteReadiness, 'mastered')
  })

  test('returns 200 advancing box 4 to 5 (+30d) and capping box 5 at 5 on subsequent good rating', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const note = await actor.app.notesDataSource.createNote(
      { title: 'Box 5 Cap', body: 'text' },
      actor.userId,
    )
    const card = await actor.app.flashcardsDataSource.createFlashcard(
      { noteId: note.id, front: 'Q', back: 'A' },
      actor.userId,
    )
    // Advance 1 -> 2 -> 3 -> 4 -> 5
    for (let step = 0; step < 4; step += 1) {
      await actor.app.flashcardsDataSource.reviewFlashcard(card.id, 'good', actor.userId)
    }

    // Act — good rating while already at box 5 stays at box 5 with +30d schedule
    const response = await actor.app.inject({
      method: 'POST',
      url: `/flashcards/${card.id}/review`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { rating: 'good' },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const { flashcard, noteReadiness } = response.json().data
    assert.equal(flashcard.box, 5)
    assert.equal(flashcard.reviewCount, 5)
    assertIntervalApproxMs(flashcard.lastReviewedAt, flashcard.nextReviewAt, 30 * DAY_MS)
    assert.equal(noteReadiness, 'mastered')
  })

  test('returns 200 keeping box 1 unchanged (+1d) on hard rating', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const note = await actor.app.notesDataSource.createNote(
      { title: 'Hard Box 1', body: 'text' },
      actor.userId,
    )
    const card = await actor.app.flashcardsDataSource.createFlashcard(
      { noteId: note.id, front: 'Q', back: 'A' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: `/flashcards/${card.id}/review`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { rating: 'hard' },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const { flashcard, noteReadiness } = response.json().data
    assert.equal(flashcard.box, 1)
    assert.equal(flashcard.lapseCount, 0)
    assert.equal(flashcard.lastRating, 'hard')
    assertIntervalApproxMs(flashcard.lastReviewedAt, flashcard.nextReviewAt, 1 * DAY_MS)
    assert.equal(noteReadiness, 'in_progress')
  })

  test('returns 200 keeping box 4 unchanged (+14d) and preserving mastered parent Note on hard rating', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const note = await actor.app.notesDataSource.createNote(
      { title: 'Hard Box 4', body: 'text' },
      actor.userId,
    )
    const card = await actor.app.flashcardsDataSource.createFlashcard(
      { noteId: note.id, front: 'Q', back: 'A' },
      actor.userId,
    )
    for (let step = 0; step < 3; step += 1) {
      await actor.app.flashcardsDataSource.reviewFlashcard(card.id, 'good', actor.userId)
    }

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: `/flashcards/${card.id}/review`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { rating: 'hard' },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const { flashcard, noteReadiness } = response.json().data
    assert.equal(flashcard.box, 4)
    assert.equal(flashcard.lapseCount, 0)
    assert.equal(flashcard.lastRating, 'hard')
    assertIntervalApproxMs(flashcard.lastReviewedAt, flashcard.nextReviewAt, 14 * DAY_MS)
    assert.equal(noteReadiness, 'mastered')
  })

  test('returns 200 resetting to box 1 (+1h), incrementing lapseCount, and demoting mastered parent Note to in_progress on again rating', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const note = await actor.app.notesDataSource.createNote(
      { title: 'Demotion Check', body: 'text' },
      actor.userId,
    )
    const card = await actor.app.flashcardsDataSource.createFlashcard(
      { noteId: note.id, front: 'Q', back: 'A' },
      actor.userId,
    )
    // Advance to box 4 so parent Note auto-promotes to mastered
    for (let step = 0; step < 3; step += 1) {
      await actor.app.flashcardsDataSource.reviewFlashcard(card.id, 'good', actor.userId)
    }
    const masteredNote = await actor.app.notesDataSource.readNote(note.id, actor.userId)
    assert.equal(masteredNote.readiness, 'mastered')

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: `/flashcards/${card.id}/review`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { rating: 'again' },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const { flashcard, noteReadiness } = response.json().data
    assert.equal(flashcard.box, 1)
    assert.equal(flashcard.lapseCount, 1)
    assert.equal(flashcard.lastRating, 'again')
    assertIntervalApproxMs(flashcard.lastReviewedAt, flashcard.nextReviewAt, HOUR_MS)
    assert.equal(noteReadiness, 'in_progress')
  })

  test('returns 400 when rating is missing or outside again | hard | good', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const note = await actor.app.notesDataSource.createNote(
      { title: 'Invalid Rating Note', body: 'text' },
      actor.userId,
    )
    const card = await actor.app.flashcardsDataSource.createFlashcard(
      { noteId: note.id, front: 'Q', back: 'A' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: `/flashcards/${card.id}/review`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { rating: 'easy' },
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 400 when flashcard id param is not a valid UUID', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: '/flashcards/not-a-uuid/review',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { rating: 'good' },
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
      method: 'POST',
      url: `/flashcards/${card.id}/review`,
      payload: { rating: 'good' },
    })

    // Assert
    assert.equal(response.statusCode, 401)
  })

  test('returns 404 when flashcard does not exist', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: `/flashcards/${randomUUIDv7()}/review`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { rating: 'good' },
    })

    // Assert
    assert.equal(response.statusCode, 404)
  })

  test('returns 404 when another user attempts to review the flashcard', async (t) => {
    // Arrange
    const owner = await seedUser(t)
    const intruder = await seedUser(t, { app: owner.app })
    const ownerNote = await owner.app.notesDataSource.createNote(
      { title: 'Owner Note', body: 'secret' },
      owner.userId,
    )
    const ownerCard = await owner.app.flashcardsDataSource.createFlashcard(
      { noteId: ownerNote.id, front: 'Q', back: 'A' },
      owner.userId,
    )

    // Act
    const response = await intruder.app.inject({
      method: 'POST',
      url: `/flashcards/${ownerCard.id}/review`,
      headers: { Authorization: `Bearer ${intruder.accessToken}` },
      payload: { rating: 'again' },
    })

    // Assert
    assert.equal(response.statusCode, 404)
    const unchanged = await owner.app.flashcardsDataSource.readFlashcard(ownerCard.id, owner.userId)
    assert.equal(unchanged.reviewCount, 0)
  })
})
