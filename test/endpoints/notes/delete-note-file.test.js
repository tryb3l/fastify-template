'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUIDv7 } = require('node:crypto')
const { createNote } = require('../../utils/note-creator')
const { fileExists, uploadNoteAttachment } = require('../../utils/notes-files')
const { seedUser } = require('../../utils/setup-user')

describe('DELETE /files/:fileId', () => {
  test('returns 204, removes attachment from Note, unlinks disk blob, and increments revision', async (t) => {
    // Arrange
    const { app, accessToken, userId, note } = await createNote(t)
    const { uploadedFile, serverPath } = await uploadNoteAttachment(
      app,
      accessToken,
      note.data.id,
      'delete-target-blob',
      { filename: 'part1.txt', contentType: 'text/plain' },
      t,
    )
    assert.equal(await fileExists(serverPath), true)
    const afterUpload = await app.notesDataSource.readNote(note.data.id, userId)
    assert.equal(afterUpload.revision, 2)

    // Act
    const response = await app.inject({
      method: 'DELETE',
      url: `/files/${uploadedFile.fileId}?noteId=${note.data.id}`,
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 204)
    assert.equal(response.body, '')
    assert.equal(await fileExists(serverPath), false)

    const afterDelete = await app.notesDataSource.readNote(note.data.id, userId)
    assert.equal(afterDelete.revision, 3)
    assert.deepEqual(afterDelete.attachments, [])
  })

  test('returns 404 when attempting to delete an already-removed attachment', async (t) => {
    // Arrange
    const { app, accessToken, userId, note } = await createNote(t)
    const { uploadedFile } = await uploadNoteAttachment(
      app,
      accessToken,
      note.data.id,
      'delete-once-blob',
      { filename: 'once.txt', contentType: 'text/plain' },
      t,
    )
    await app.notesDataSource.removeAttachment(note.data.id, uploadedFile.fileId, userId)

    // Act
    const response = await app.inject({
      method: 'DELETE',
      url: `/files/${uploadedFile.fileId}?noteId=${note.data.id}`,
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 404)
  })

  test('returns 400 when fileId or noteId is not a valid UUID', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'DELETE',
      url: `/files/not-a-uuid?noteId=${randomUUIDv7()}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 401 when unauthenticated', async (t) => {
    // Arrange
    const { app, accessToken, note } = await createNote(t)
    const { uploadedFile } = await uploadNoteAttachment(
      app,
      accessToken,
      note.data.id,
      'protected-blob',
      { filename: 'protected.txt', contentType: 'text/plain' },
      t,
    )

    // Act
    const response = await app.inject({
      method: 'DELETE',
      url: `/files/${uploadedFile.fileId}?noteId=${note.data.id}`,
    })

    // Assert
    assert.equal(response.statusCode, 401)
  })

  test('returns 404 when attachment or Note does not exist', async (t) => {
    // Arrange
    const { app, accessToken, note } = await createNote(t)

    // Act
    const response = await app.inject({
      method: 'DELETE',
      url: `/files/${randomUUIDv7()}?noteId=${note.data.id}`,
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 404)
  })

  test('returns 404 when another user attempts to delete the attachment', async (t) => {
    // Arrange
    const owner = await createNote(t)
    const intruder = await seedUser(t, { app: owner.app })
    const { uploadedFile, serverPath } = await uploadNoteAttachment(
      owner.app,
      owner.accessToken,
      owner.note.data.id,
      'owner-blob',
      { filename: 'owner.txt', contentType: 'text/plain' },
      t,
    )

    // Act
    const response = await intruder.app.inject({
      method: 'DELETE',
      url: `/files/${uploadedFile.fileId}?noteId=${owner.note.data.id}`,
      headers: { Authorization: `Bearer ${intruder.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 404)
    assert.equal(await fileExists(serverPath), true)
  })
})
