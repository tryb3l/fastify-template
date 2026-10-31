'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { createNote } = require('../../../../utils/note-creator')
const { setup } = require('../../../../utils/setup-user')

test('GET /notes 200 - List notes', async (t) => {
  // Arrange
  const { app, accessToken, note } = await createNote(t)

  // Act
  const response = await app.inject({
    method: 'GET',
    url: '/notes',
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  assert.strictEqual(response.statusCode, 200)
  const payload = response.json()
  assert.ok(Array.isArray(payload.data))
  assert.strictEqual(payload.data.length, 1)
  assert.strictEqual(payload.totalCount, 1)
  assert.strictEqual(payload.data[0].title, note.data.title)
  assert.strictEqual(Object.hasOwn(payload.data[0], 'body'), false)
  assert.strictEqual(Object.hasOwn(payload.data[0], 'attachments'), false)
})

test('GET /notes 200 - List notes with pagination', async (t) => {
  // Arrange
  const { app, accessToken } = await createNote(t)
  await app.inject({
    method: 'POST',
    url: '/notes',
    payload: { title: 'Second Note', body: 'Second Body' },
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Act
  const response = await app.inject({
    method: 'GET',
    url: '/notes?skip=0&limit=1',
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  assert.strictEqual(response.statusCode, 200)
  const payload = response.json()
  assert.ok(Array.isArray(payload.data))
  assert.strictEqual(payload.data.length, 1, 'Should respect the limit of 1')
  assert.strictEqual(payload.totalCount, 2, 'Should return total amount of records despite limit')
})

test('GET /notes 200 - Filter notes by title', async (t) => {
  // Arrange
  const { app, accessToken, note } = await createNote(t)

  // Act
  const response = await app.inject({
    method: 'GET',
    url: `/notes?title=${encodeURIComponent(note.data.title)}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  assert.strictEqual(response.statusCode, 200)
  const payload = response.json()
  assert.ok(Array.isArray(payload.data))
  assert.strictEqual(payload.data[0].title, note.data.title)
  assert.strictEqual(payload.totalCount, 1)
})

test('GET /notes 400 - Invalid skip and limit (negative values)', async (t) => {
  // Arrange
  const { app, accessToken } = await setup(t, 'user')

  // Act
  const response = await app.inject({
    method: 'GET',
    url: '/notes?skip=-1&limit=-5',
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  assert.strictEqual(response.statusCode, 400)
})

test('GET /notes 400 - Invalid skip and limit (exceeds maximum)', async (t) => {
  // Arrange
  const { app, accessToken } = await setup(t, 'user')

  // Act
  const response = await app.inject({
    method: 'GET',
    url: '/notes?skip=101&limit=101',
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  assert.strictEqual(response.statusCode, 400)
})

test('GET /notes 401 - Unauthorized', async (t) => {
  // Arrange
  const { app } = await setup(t, 'user')

  // Act
  const response = await app.inject({
    method: 'GET',
    url: '/notes',
  })

  // Assert
  assert.strictEqual(response.statusCode, 401)
})

test('GET /notes 200 - Escapes special regex characters in title filter and sorts by modifiedAt desc', async (t) => {
  const { app, accessToken } = await setup(t, 'user')

  const specialTitle = '[Draft] (v1.0+?) *notes*'
  const createRes1 = await app.inject({
    method: 'POST',
    url: '/notes',
    headers: { Authorization: `Bearer ${accessToken}` },
    payload: { title: 'Older Note', body: 'first' },
  })
  assert.strictEqual(createRes1.statusCode, 201)

  await new Promise((r) => setTimeout(r, 15))

  const createRes2 = await app.inject({
    method: 'POST',
    url: '/notes',
    headers: { Authorization: `Bearer ${accessToken}` },
    payload: { title: specialTitle, body: 'second' },
  })
  assert.strictEqual(createRes2.statusCode, 201)

  const searchRes = await app.inject({
    method: 'GET',
    url: `/notes?title=${encodeURIComponent('[Draft] (v1.0+?)')}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  assert.strictEqual(searchRes.statusCode, 200)
  assert.strictEqual(searchRes.json().data.length, 1)
  assert.strictEqual(searchRes.json().data[0].title, specialTitle)

  const listAllRes = await app.inject({
    method: 'GET',
    url: '/notes',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  assert.strictEqual(listAllRes.statusCode, 200)
  assert.strictEqual(listAllRes.json().data[0].title, specialTitle)
})

test('GET /notes/sync - Returns upserted and deleted notes, notebooks, and folders since cursor and rejects expired cursors with 410', async (t) => {
  const { app, accessToken } = await setup(t, 'user')

  const initialNbRes = await app.inject({
    method: 'POST',
    url: '/notebooks',
    headers: { Authorization: `Bearer ${accessToken}` },
    payload: { name: 'Sync NB' },
  })
  assert.strictEqual(initialNbRes.statusCode, 201)
  const nb = initialNbRes.json().data

  const initialFolderRes = await app.inject({
    method: 'POST',
    url: `/notebooks/${nb.id}/folders`,
    headers: { Authorization: `Bearer ${accessToken}` },
    payload: { name: 'Sync Folder' },
  })
  assert.strictEqual(initialFolderRes.statusCode, 201)
  const folder = initialFolderRes.json().data

  const initialNoteRes = await app.inject({
    method: 'POST',
    url: '/notes',
    headers: { Authorization: `Bearer ${accessToken}` },
    payload: { title: 'Note to delete', body: 'bye' },
  })
  assert.strictEqual(initialNoteRes.statusCode, 201)
  const noteToDelete = initialNoteRes.json().data

  await new Promise((r) => setTimeout(r, 20))
  const sinceIso = new Date().toISOString()
  await new Promise((r) => setTimeout(r, 20))

  // Create a new note and delete the initial note, folder, and notebook
  const newNoteRes = await app.inject({
    method: 'POST',
    url: '/notes',
    headers: { Authorization: `Bearer ${accessToken}` },
    payload: { title: 'Newly synced note', body: 'fresh content' },
  })
  assert.strictEqual(newNoteRes.statusCode, 201)
  const newNote = newNoteRes.json().data

  const delNoteRes = await app.inject({
    method: 'DELETE',
    url: `/notes/${noteToDelete.id}?expectedRevision=${noteToDelete.revision}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  assert.strictEqual(delNoteRes.statusCode, 204)

  const delFolderRes = await app.inject({
    method: 'DELETE',
    url: `/notebooks/folders/${folder.id}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  assert.strictEqual(delFolderRes.statusCode, 204)

  const delNbRes = await app.inject({
    method: 'DELETE',
    url: `/notebooks/${nb.id}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  assert.strictEqual(delNbRes.statusCode, 204)

  const syncRes = await app.inject({
    method: 'GET',
    url: `/notes/sync?since=${encodeURIComponent(sinceIso)}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  assert.strictEqual(syncRes.statusCode, 200)
  const syncData = syncRes.json().data
  assert.ok(syncData.serverTime)
  assert.strictEqual(syncData.notes.upserted.length, 1)
  assert.strictEqual(syncData.notes.upserted[0].id, newNote.id)
  assert.deepStrictEqual(syncData.notes.deletedIds, [noteToDelete.id])
  assert.deepStrictEqual(syncData.folders.deletedIds, [folder.id])
  assert.deepStrictEqual(syncData.notebooks.deletedIds, [nb.id])

  // Expired cursor (>30 days old) returns 410 Gone
  const expiredSince = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString()
  const expiredRes = await app.inject({
    method: 'GET',
    url: `/notes/sync?since=${encodeURIComponent(expiredSince)}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  assert.strictEqual(expiredRes.statusCode, 410)
  assert.strictEqual(expiredRes.json().code, 'SYNC_CURSOR_EXPIRED')

  // Future cursor (>60s ahead of server clock) returns 410 Gone
  const futureSince = new Date(Date.now() + 5 * 60 * 1000).toISOString()
  const futureRes = await app.inject({
    method: 'GET',
    url: `/notes/sync?since=${encodeURIComponent(futureSince)}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  assert.strictEqual(futureRes.statusCode, 410)
  assert.strictEqual(futureRes.json().code, 'SYNC_CURSOR_EXPIRED')

  // Tenant isolation: another user polling /notes/sync does not see the first user's upserts or tombstones
  const otherUser = await setup(t, 'user')
  const otherSyncRes = await otherUser.app.inject({
    method: 'GET',
    url: `/notes/sync?since=${encodeURIComponent(sinceIso)}`,
    headers: { Authorization: `Bearer ${otherUser.accessToken}` },
  })
  assert.strictEqual(otherSyncRes.statusCode, 200)
  assert.deepStrictEqual(otherSyncRes.json().data.notes, { upserted: [], deletedIds: [] })
  assert.deepStrictEqual(otherSyncRes.json().data.notebooks, { upserted: [], deletedIds: [] })
  assert.deepStrictEqual(otherSyncRes.json().data.folders, { upserted: [], deletedIds: [] })
})
