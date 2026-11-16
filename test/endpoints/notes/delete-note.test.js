'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUIDv7 } = require('node:crypto')
const { createNote } = require('../../utils/note-creator')
const { seedUser } = require('../../utils/setup-user')

describe('DELETE /notes/:id', () => {
  test('returns 204, deletes the note, cleans incoming backlinks, and writes a sync tombstone', async (t) => {
    // Arrange
    const { app, accessToken, userId, note } = await createNote(t)
    const noteId = note.data.id
    const referencing = await app.notesDataSource.createNote(
      {
        title: 'Referencing Note',
        body: `Ref [[${noteId}]]`,
      },
      userId,
    )

    // Act
    const response = await app.inject({
      method: 'DELETE',
      url: `/notes/${noteId}?expectedRevision=${note.data.revision}`,
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 204)
    assert.equal(response.body, '')

    await assert.rejects(() => app.notesDataSource.readNote(noteId, userId), { statusCode: 404 })

    const updatedRef = await app.notesDataSource.readNote(referencing.id, userId)
    assert.deepEqual(updatedRef.links, [])

    const tombstone = await app.mongo.db
      .collection('syncTombstones')
      .findOne({ userId, entityType: 'note', entityId: noteId })
    assert.ok(tombstone)
  })

  test('returns 204 and invalidates cached note reads after delete', async (t) => {
    // Arrange
    const { app, accessToken, userId, note } = await createNote(t)
    await app.notesDataSource.readNote(note.data.id, userId)
    assert.ok(await app.cacheGet(`note:${note.data.id}:${userId}`))

    // Act
    const response = await app.inject({
      method: 'DELETE',
      url: `/notes/${note.data.id}?expectedRevision=${note.data.revision}`,
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 204)
    assert.equal(await app.cacheGet(`note:${note.data.id}:${userId}`), null)
    await assert.rejects(() => app.notesDataSource.readNote(note.data.id, userId), {
      statusCode: 404,
    })
  })

  test('returns 400 when expectedRevision query parameter is missing', async (t) => {
    // Arrange
    const { app, accessToken, userId, note } = await createNote(t)

    // Act
    const response = await app.inject({
      method: 'DELETE',
      url: `/notes/${note.data.id}`,
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 400)
    const stillPresent = await app.notesDataSource.readNote(note.data.id, userId)
    assert.equal(stillPresent.id, note.data.id)
  })

  test('returns 400 when note id param is not a valid UUID', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'DELETE',
      url: '/notes/not-a-uuid?expectedRevision=1',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 401 when unauthenticated', async (t) => {
    // Arrange
    const { app, note } = await createNote(t)

    // Act
    const response = await app.inject({
      method: 'DELETE',
      url: `/notes/${note.data.id}?expectedRevision=${note.data.revision}`,
    })

    // Assert
    assert.equal(response.statusCode, 401)
  })

  test('returns 404 when note does not exist', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'DELETE',
      url: `/notes/${randomUUIDv7()}?expectedRevision=1`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 404)
  })

  test('returns 404 when another user attempts to delete the note', async (t) => {
    // Arrange
    const owner = await createNote(t)
    const intruder = await seedUser(t, { app: owner.app })

    // Act
    const response = await intruder.app.inject({
      method: 'DELETE',
      url: `/notes/${owner.note.data.id}?expectedRevision=${owner.note.data.revision}`,
      headers: { Authorization: `Bearer ${intruder.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 404)
    const stillExists = await owner.app.notesDataSource.readNote(owner.note.data.id, owner.userId)
    assert.equal(stillExists.id, owner.note.data.id)
  })

  test('returns 409 NOTE_STALE_DELETE when expectedRevision is stale', async (t) => {
    // Arrange
    const { app, accessToken, userId, note } = await createNote(t)
    const staleRevision = note.data.revision
    const updated = await app.notesDataSource.updateNote(
      note.data.id,
      { title: 'Updated elsewhere', expectedRevision: staleRevision },
      userId,
    )

    // Act
    const response = await app.inject({
      method: 'DELETE',
      url: `/notes/${note.data.id}?expectedRevision=${staleRevision}`,
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 409)
    assert.equal(response.json().code, 'NOTE_STALE_DELETE')
    assert.equal(response.json().currentRevision, updated.revision)
    const stillLatest = await app.notesDataSource.readNote(note.data.id, userId)
    assert.equal(stillLatest.title, 'Updated elsewhere')
  })
})
