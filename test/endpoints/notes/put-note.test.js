'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUIDv7 } = require('node:crypto')
const { createNote } = require('../../utils/note-creator')
const { randomString } = require('../../utils/data-creator')
const { buildMarkdownNote } = require('../../utils/markdown-note')
const { seedUser } = require('../../utils/setup-user')

describe('PUT /notes/:id', () => {
  test('returns 200 and updates note fields while incrementing revision', async (t) => {
    // Arrange
    const { app, accessToken, note } = await createNote(t)
    const noteId = note.data.id
    const updatedNote = {
      title: randomString(15),
      body: randomString(30),
      tags: [randomString(5), randomString(5)],
      readiness: 'in_progress',
      noteType: 'post_mortem',
      expectedRevision: note.data.revision,
    }

    // Act
    const response = await app.inject({
      method: 'PUT',
      url: `/notes/${noteId}`,
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: updatedNote,
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const data = response.json().data
    assert.equal(data.id, noteId)
    assert.equal(data.title, updatedNote.title)
    assert.equal(data.body, updatedNote.body)
    assert.deepEqual(data.tags, updatedNote.tags)
    assert.equal(data.readiness, 'in_progress')
    assert.equal(data.noteType, 'post_mortem')
    assert.equal(data.revision, note.data.revision + 1)
  })

  test('returns 200 for partial update without clearing untouched fields', async (t) => {
    // Arrange
    const { app, accessToken, note } = await createNote(t)
    const renamedTitle = randomString(18)

    // Act
    const response = await app.inject({
      method: 'PUT',
      url: `/notes/${note.data.id}`,
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { title: renamedTitle, expectedRevision: note.data.revision },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.equal(response.json().data.title, renamedTitle)
    assert.equal(response.json().data.body, note.data.body)
    assert.equal(response.json().data.revision, note.data.revision + 1)
  })

  test('returns 200 moving a note between Notebook, Folder, and Inbox', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const notebook = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Destination NB' },
      actor.userId,
    )
    const folder = await actor.app.notebooksDataSource.createFolder(
      { notebookId: notebook.id, name: 'Target Folder' },
      actor.userId,
    )
    const note = await actor.app.notesDataSource.createNote(
      {
        title: 'Movable Note',
        body: 'Inside folder',
        notebookId: notebook.id,
        folderId: folder.id,
      },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'PUT',
      url: `/notes/${note.id}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: {
        notebookId: null,
        expectedRevision: note.revision,
      },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.equal(response.json().data.notebookId, null)
    assert.equal(response.json().data.folderId, null)
    assert.equal(response.json().data.revision, note.revision + 1)
  })

  test('returns 200 updating readiness and noteType metadata', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const note = await actor.app.notesDataSource.createNote(
      { title: 'Standard Draft', body: 'content' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'PUT',
      url: `/notes/${note.id}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: {
        readiness: 'mastered',
        noteType: 'post_mortem',
        expectedRevision: note.revision,
      },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.equal(response.json().data.readiness, 'mastered')
    assert.equal(response.json().data.noteType, 'post_mortem')
    assert.equal(response.json().data.revision, note.revision + 1)
  })

  test('returns 200 and accepts an explicitly empty body', async (t) => {
    // Arrange
    const { app, accessToken, note } = await createNote(t)

    // Act
    const response = await app.inject({
      method: 'PUT',
      url: `/notes/${note.data.id}`,
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { body: '', expectedRevision: note.data.revision },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.equal(response.json().data.body, '')
  })

  test('returns 200 preserving a large 32KB+ Markdown body', async (t) => {
    // Arrange
    const { app, accessToken, userId, note } = await createNote(t)
    const markdownBody = buildMarkdownNote({ minLength: 32_000 })

    // Act
    const response = await app.inject({
      method: 'PUT',
      url: `/notes/${note.data.id}`,
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: {
        title: 'Milkdown updated note',
        body: markdownBody,
        tags: ['markdown', 'updated'],
        expectedRevision: note.data.revision,
      },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.equal(response.json().data.body, markdownBody)
    const persisted = await app.notesDataSource.readNote(note.data.id, userId)
    assert.equal(persisted.body, markdownBody)
  })

  test('returns 200 and invalidates cached note reads after update', async (t) => {
    // Arrange
    const { app, accessToken, userId, note } = await createNote(t)
    const noteId = note.data.id
    await app.notesDataSource.readNote(noteId, userId)
    assert.ok(await app.cacheGet(`note:${noteId}:${userId}`))
    const newTitle = randomString(15)

    // Act
    const response = await app.inject({
      method: 'PUT',
      url: `/notes/${noteId}`,
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: {
        title: newTitle,
        body: randomString(25),
        expectedRevision: note.data.revision,
      },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.equal(await app.cacheGet(`note:${noteId}:${userId}`), null)
    const refreshedRead = await app.notesDataSource.readNote(noteId, userId)
    assert.equal(refreshedRead.title, newTitle)
  })

  test('returns 200 on partial no-op autosave with identical title without bumping revision', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const note = await actor.app.notesDataSource.createNote(
      { title: 'Partial Autosave', body: 'Kept content', tags: ['keep'] },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'PUT',
      url: `/notes/${note.id}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { title: note.title, expectedRevision: note.revision },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.equal(response.json().data.revision, note.revision)
    assert.equal(response.json().data.modifiedAt, note.modifiedAt.toISOString())
  })

  test('returns 200 preserving a 50000 character Markdown body', async (t) => {
    // Arrange
    const { app, accessToken, userId, note } = await createNote(t)
    const noteId = note.data.id
    const body = 'b'.repeat(50_000)

    // Act
    const response = await app.inject({
      method: 'PUT',
      url: `/notes/${noteId}`,
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: {
        title: 'Boundary update accepted',
        body,
        expectedRevision: note.data.revision,
      },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.equal(response.json().data.body, body)
    const persisted = await app.notesDataSource.readNote(noteId, userId)
    assert.equal(persisted.body, body)
  })

  test('returns 200 on full no-op autosave with unchanged fields and links without bumping revision, modifiedAt, or writing auditLogs', async (t) => {
    // Arrange
    const owner = await createNote(t, { title: 'Target Note', body: 'Target' })
    const targetId = owner.note.data.id
    const sourceNote = await owner.app.notesDataSource.createNote(
      {
        title: 'Autosave Source',
        body: `Inline link [[${targetId}|Target]]`,
        tags: ['alpha', 'beta'],
        links: [{ targetId, relation: 'parent', label: 'Explicit Parent' }],
      },
      owner.userId,
    )

    // Act
    const response = await owner.app.inject({
      method: 'PUT',
      url: `/notes/${sourceNote.id}`,
      headers: { Authorization: `Bearer ${owner.accessToken}` },
      payload: {
        title: sourceNote.title,
        body: sourceNote.body,
        tags: sourceNote.tags,
        links: [{ targetId, relation: 'parent', label: 'Explicit Parent' }],
        expectedRevision: sourceNote.revision,
      },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.equal(response.json().data.revision, sourceNote.revision)
    assert.equal(response.json().data.modifiedAt, sourceNote.modifiedAt.toISOString())

    await owner.app.flushAuditLogs()
    const updateAuditCount = await owner.app.mongo.db
      .collection('auditLogs')
      .countDocuments({ action: 'note_updated', resourceId: sourceNote.id })
    assert.equal(updateAuditCount, 0)
  })

  test('returns 200 on real body edit without emitting routine note_updated audit spam', async (t) => {
    // Arrange
    const owner = await createNote(t, { title: 'Autosave Audit Check', body: 'Initial' })

    // Act
    const response = await owner.app.inject({
      method: 'PUT',
      url: `/notes/${owner.note.data.id}`,
      headers: { Authorization: `Bearer ${owner.accessToken}` },
      payload: {
        body: 'Updated autosave body',
        expectedRevision: owner.note.data.revision,
      },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.equal(response.json().data.revision, owner.note.data.revision + 1)

    await owner.app.flushAuditLogs()
    const updateAuditCount = await owner.app.mongo.db
      .collection('auditLogs')
      .countDocuments({ action: 'note_updated', resourceId: owner.note.data.id })
    assert.equal(updateAuditCount, 0)
  })

  test('returns 200 removing stale inline wiki-link when body edit drops the link', async (t) => {
    // Arrange
    const owner = await createNote(t, { title: 'Linked Target', body: 'Target' })
    const source = await owner.app.notesDataSource.createNote(
      {
        title: 'Source Note',
        body: `See [[${owner.note.data.id}]]`,
      },
      owner.userId,
    )
    assert.deepEqual(source.links, [{ targetId: owner.note.data.id, relation: 'related' }])

    // Act
    const response = await owner.app.inject({
      method: 'PUT',
      url: `/notes/${source.id}`,
      headers: { Authorization: `Bearer ${owner.accessToken}` },
      payload: {
        body: 'Removed inline link',
        expectedRevision: source.revision,
      },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.deepEqual(response.json().data.links, [])
  })

  test('returns 400 when note body exceeds the 50000 character limit without mutating note', async (t) => {
    // Arrange
    const { app, accessToken, userId, note } = await createNote(t)

    // Act
    const response = await app.inject({
      method: 'PUT',
      url: `/notes/${note.data.id}`,
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: {
        title: 'Boundary update rejected',
        body: 'b'.repeat(50_001),
        expectedRevision: note.data.revision,
      },
    })

    // Assert
    assert.equal(response.statusCode, 400)
    const unchanged = await app.notesDataSource.readNote(note.data.id, userId)
    assert.equal(unchanged.body, note.data.body)
  })

  test('returns 400 when expectedRevision is missing', async (t) => {
    // Arrange
    const { app, accessToken, note } = await createNote(t)

    // Act
    const response = await app.inject({
      method: 'PUT',
      url: `/notes/${note.data.id}`,
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { title: randomString(10), body: randomString(20) },
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 400 when note id param is not a valid UUID', async (t) => {
    // Arrange
    const { app, accessToken, note } = await createNote(t)

    // Act
    const response = await app.inject({
      method: 'PUT',
      url: '/notes/invalid-id-format',
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { title: randomString(10), expectedRevision: note.data.revision },
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 401 when unauthenticated', async (t) => {
    // Arrange
    const { app, note } = await createNote(t)

    // Act
    const response = await app.inject({
      method: 'PUT',
      url: `/notes/${note.data.id}`,
      payload: { title: randomString(10), expectedRevision: note.data.revision },
    })

    // Assert
    assert.equal(response.statusCode, 401)
  })

  test('returns 404 when note does not exist', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'PUT',
      url: `/notes/${randomUUIDv7()}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { title: randomString(10), expectedRevision: 1 },
    })

    // Assert
    assert.equal(response.statusCode, 404)
  })

  test('returns 404 when another user attempts to update the note', async (t) => {
    // Arrange
    const owner = await createNote(t)
    const intruder = await seedUser(t, { app: owner.app })

    // Act
    const response = await intruder.app.inject({
      method: 'PUT',
      url: `/notes/${owner.note.data.id}`,
      headers: { Authorization: `Bearer ${intruder.accessToken}` },
      payload: { title: 'intruder-update', expectedRevision: owner.note.data.revision },
    })

    // Assert
    assert.equal(response.statusCode, 404)
    const unchanged = await owner.app.notesDataSource.readNote(owner.note.data.id, owner.userId)
    assert.equal(unchanged.title, owner.note.data.title)
  })

  test('returns 409 NOTE_STALE_SAVE when expectedRevision is stale', async (t) => {
    // Arrange
    const { app, accessToken, userId, note } = await createNote(t)
    const firstEdit = await app.notesDataSource.updateNote(
      note.data.id,
      { title: 'First persisted edit', expectedRevision: note.data.revision },
      userId,
    )

    // Act
    const response = await app.inject({
      method: 'PUT',
      url: `/notes/${note.data.id}`,
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { title: 'Stale edit attempt', expectedRevision: note.data.revision },
    })

    // Assert
    assert.equal(response.statusCode, 409)
    const payload = response.json()
    assert.equal(payload.code, 'NOTE_STALE_SAVE')
    assert.equal(
      payload.message,
      'Note was modified elsewhere. Reload the latest note before saving again.',
    )
    assert.equal(payload.currentRevision, firstEdit.revision)
    assert.equal(payload.currentModifiedAt, firstEdit.modifiedAt.toISOString())
  })

  test('returns 409 for the losing request when concurrent PUT updates share expectedRevision', async (t) => {
    // Arrange
    const { app, accessToken, note } = await createNote(t)
    const initialRevision = note.data.revision
    const updateA = {
      title: 'Concurrent update A',
      body: 'Body A',
      expectedRevision: initialRevision,
    }
    const updateB = {
      title: 'Concurrent update B',
      body: 'Body B',
      expectedRevision: initialRevision,
    }

    // Act
    const [responseA, responseB] = await Promise.all([
      app.inject({
        method: 'PUT',
        url: `/notes/${note.data.id}`,
        headers: { Authorization: `Bearer ${accessToken}` },
        payload: updateA,
      }),
      app.inject({
        method: 'PUT',
        url: `/notes/${note.data.id}`,
        headers: { Authorization: `Bearer ${accessToken}` },
        payload: updateB,
      }),
    ])

    // Assert
    assert.deepEqual([responseA.statusCode, responseB.statusCode].sort(), [200, 409])
    const [winner, loser] =
      responseA.statusCode === 200 ? [responseA, responseB] : [responseB, responseA]
    assert.equal(loser.json().code, 'NOTE_STALE_SAVE')
    assert.equal(loser.json().currentRevision, winner.json().data.revision)
    assert.equal(winner.json().data.revision, initialRevision + 1)
  })
})
