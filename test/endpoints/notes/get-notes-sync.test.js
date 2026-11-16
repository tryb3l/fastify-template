'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { setTimeout: delay } = require('node:timers/promises')
const { seedUser } = require('../../utils/setup-user')

describe('GET /notes/sync', () => {
  test('returns 200 with upserted Notes, Notebooks, Folders, Flashcards and Sync Tombstones since cursor', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const nb = await actor.app.notebooksDataSource.createNotebook({ name: 'Sync NB' }, actor.userId)
    const folder = await actor.app.notebooksDataSource.createFolder(
      { notebookId: nb.id, name: 'Sync Folder' },
      actor.userId,
    )
    const noteToDelete = await actor.app.notesDataSource.createNote(
      { title: 'Note to delete', body: 'bye' },
      actor.userId,
    )
    const fcNote = await actor.app.notesDataSource.createNote(
      { title: 'Card Owner', body: 'q&a' },
      actor.userId,
    )
    const flashcardToDelete = await actor.app.flashcardsDataSource.createFlashcard(
      { noteId: fcNote.id, front: 'Old Q', back: 'Old A' },
      actor.userId,
    )

    await delay(20)
    const sinceIso = new Date().toISOString()
    await delay(20)

    const newNote = await actor.app.notesDataSource.createNote(
      { title: 'Newly synced note', body: 'fresh content' },
      actor.userId,
    )
    const newCard = await actor.app.flashcardsDataSource.createFlashcard(
      { noteId: newNote.id, front: 'New Q', back: 'New A' },
      actor.userId,
    )
    await actor.app.notesDataSource.deleteNote(noteToDelete.id, actor.userId, noteToDelete.revision)
    await actor.app.flashcardsDataSource.deleteFlashcard(flashcardToDelete.id, actor.userId)
    await actor.app.notebooksDataSource.deleteFolder(folder.id, actor.userId)
    await actor.app.notebooksDataSource.deleteNotebook(nb.id, actor.userId)

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: `/notes/sync?since=${encodeURIComponent(sinceIso)}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const syncData = response.json().data
    assert.ok(syncData.serverTime)
    assert.equal(syncData.hasMore, false)
    assert.equal(syncData.nextCursor, null)
    assert.equal(syncData.notes.upserted.length, 1)
    assert.equal(syncData.notes.upserted[0].id, newNote.id)
    assert.deepEqual(syncData.notes.deletedIds, [noteToDelete.id])
    assert.equal(syncData.flashcards.upserted.length, 1)
    assert.equal(syncData.flashcards.upserted[0].id, newCard.id)
    assert.deepEqual(syncData.flashcards.deletedIds, [flashcardToDelete.id])
    assert.deepEqual(syncData.folders.deletedIds, [folder.id])
    assert.deepEqual(syncData.notebooks.deletedIds, [nb.id])
  })

  test('returns 200 bounded by limit and exposes nextCursor for same-millisecond batch pagination', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const sinceIso = new Date(Date.now() - 1_000).toISOString()

    await actor.app.notesDataSource.createNotes(
      [
        { title: 'Batch 1', body: 'b1', tags: [] },
        { title: 'Batch 2', body: 'b2', tags: [] },
        { title: 'Batch 3', body: 'b3', tags: [] },
        { title: 'Batch 4', body: 'b4', tags: [] },
        { title: 'Batch 5', body: 'b5', tags: [] },
      ],
      actor.userId,
    )
    await actor.app.notebooksDataSource.createNotebook({ name: 'Sync Page NB 1' }, actor.userId)
    await actor.app.notebooksDataSource.createNotebook({ name: 'Sync Page NB 2' }, actor.userId)
    await actor.app.notebooksDataSource.createNotebook({ name: 'Sync Page NB 3' }, actor.userId)

    // Act
    const firstPageRes = await actor.app.inject({
      method: 'GET',
      url: `/notes/sync?since=${encodeURIComponent(sinceIso)}&limit=2`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(firstPageRes.statusCode, 200)
    const firstPage = firstPageRes.json().data
    assert.equal(firstPage.notes.upserted.length, 2)
    assert.equal(firstPage.notebooks.upserted.length, 2)
    assert.equal(firstPage.hasMore, true)
    assert.equal(typeof firstPage.nextCursor, 'string')
    assert.ok(firstPage.serverTime)
  })

  test('returns 200 advancing across paginated pages via cursor without duplicating same-millisecond records', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const sinceIso = new Date(Date.now() - 1_000).toISOString()

    const batchIds = await actor.app.notesDataSource.createNotes(
      [
        { title: 'Batch 1', body: 'b1', tags: [] },
        { title: 'Batch 2', body: 'b2', tags: [] },
        { title: 'Batch 3', body: 'b3', tags: [] },
        { title: 'Batch 4', body: 'b4', tags: [] },
        { title: 'Batch 5', body: 'b5', tags: [] },
      ],
      actor.userId,
    )
    const firstPageData = await actor.app.notesDataSource.getWorkspaceSyncDelta(
      sinceIso,
      actor.userId,
      { limit: 2 },
    )
    assert.equal(firstPageData.hasMore, true)

    // Act
    const secondPageRes = await actor.app.inject({
      method: 'GET',
      url: `/notes/sync?since=${encodeURIComponent(sinceIso)}&limit=2&cursor=${encodeURIComponent(firstPageData.nextCursor)}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(secondPageRes.statusCode, 200)
    const secondPage = secondPageRes.json().data
    assert.equal(secondPage.notes.upserted.length, 2)
    assert.equal(secondPage.hasMore, true)

    const thirdPageData = await actor.app.notesDataSource.getWorkspaceSyncDelta(
      sinceIso,
      actor.userId,
      { limit: 2, cursor: secondPage.nextCursor },
    )
    assert.equal(thirdPageData.hasMore, false)
    assert.equal(thirdPageData.nextCursor, null)

    const allNoteIds = [
      ...firstPageData.notes.upserted.map((n) => n.id),
      ...secondPage.notes.upserted.map((n) => n.id),
      ...thirdPageData.notes.upserted.map((n) => n.id),
    ]
    assert.equal(new Set(allNoteIds).size, 5)
    assert.deepEqual(allNoteIds.slice().sort(), batchIds.slice().sort())
  })

  test('returns 200 with empty delta for another user (tenant isolation)', async (t) => {
    // Arrange
    const owner = await seedUser(t)
    const intruder = await seedUser(t, { app: owner.app })
    const sinceIso = new Date(Date.now() - 1_000).toISOString()
    await owner.app.notesDataSource.createNote(
      { title: 'Owner Note', body: 'secret' },
      owner.userId,
    )

    // Act
    const response = await intruder.app.inject({
      method: 'GET',
      url: `/notes/sync?since=${encodeURIComponent(sinceIso)}`,
      headers: { Authorization: `Bearer ${intruder.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const data = response.json().data
    assert.equal(data.hasMore, false)
    assert.equal(data.nextCursor, null)
    assert.deepEqual(data.notes, { upserted: [], deletedIds: [] })
    assert.deepEqual(data.notebooks, { upserted: [], deletedIds: [] })
    assert.deepEqual(data.folders, { upserted: [], deletedIds: [] })
    assert.deepEqual(data.flashcards, { upserted: [], deletedIds: [] })
  })

  test('returns 400 when limit exceeds maximum of 1000', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const sinceIso = new Date(Date.now() - 1_000).toISOString()

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: `/notes/sync?since=${encodeURIComponent(sinceIso)}&limit=1001`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 400 when cursor is malformed base64url', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const sinceIso = new Date(Date.now() - 1_000).toISOString()

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: `/notes/sync?since=${encodeURIComponent(sinceIso)}&cursor=not-valid-cursor`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 400 when cursor rewinds timestamp before since', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const sinceIso = new Date(Date.now() - 1_000).toISOString()
    const rewoundCursor = Buffer.from(
      JSON.stringify({
        v: 1,
        t0: Date.now(),
        s: {
          notes: { done: false, ts: 1_000, id: '01950000-0000-7000-8000-000000000001' },
          notebooks: { done: true, ts: 0, id: '' },
          folders: { done: true, ts: 0, id: '' },
          flashcards: { done: true, ts: 0, id: '' },
          tombstones: { done: true, ts: 0, id: '' },
        },
      }),
      'utf8',
    ).toString('base64url')

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: `/notes/sync?since=${encodeURIComponent(sinceIso)}&cursor=${encodeURIComponent(rewoundCursor)}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 401 when unauthenticated', async (t) => {
    // Arrange
    const { app } = await seedUser(t)

    // Act
    const response = await app.inject({
      method: 'GET',
      url: `/notes/sync?since=${encodeURIComponent(new Date().toISOString())}`,
    })

    // Assert
    assert.equal(response.statusCode, 401)
  })

  test('returns 410 SYNC_CURSOR_EXPIRED when since is older than 30 days', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const expiredSince = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString()

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: `/notes/sync?since=${encodeURIComponent(expiredSince)}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 410)
    assert.equal(response.json().code, 'SYNC_CURSOR_EXPIRED')
  })

  test('returns 410 SYNC_CURSOR_EXPIRED when since is further ahead than 60 seconds', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const futureSince = new Date(Date.now() + 5 * 60 * 1000).toISOString()

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: `/notes/sync?since=${encodeURIComponent(futureSince)}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 410)
    assert.equal(response.json().code, 'SYNC_CURSOR_EXPIRED')
  })
})
