'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUIDv7 } = require('node:crypto')
const { once } = require('node:events')
const { setTimeout: delay } = require('node:timers/promises')
const WebSocket = require('ws')
const { randomEmail } = require('../utils/data-creator')
const { seedUser } = require('../utils/setup-user')

function connectSocket(t, app, noteId, accessToken) {
  const port = app.server.address().port
  const isHttps = Boolean(app.initialConfig?.https)
  const protocol = isHttps ? 'wss' : 'ws'
  const ws = new WebSocket(`${protocol}://127.0.0.1:${port}/notes/live/${noteId}`, {
    ...(isHttps ? { rejectUnauthorized: false } : {}),
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  t.after(async () => {
    if (ws.readyState !== WebSocket.CLOSED) {
      const closePromise = once(ws, 'close').catch(() => {})
      ws.terminate()
      await closePromise
    }
  })
  return ws
}

async function waitForOpen(ws) {
  if (ws.readyState === WebSocket.OPEN) return
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket open timeout')), 2000)
    ws.once('open', () => {
      clearTimeout(timer)
      resolve()
    })
    ws.once('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

async function readNextFrame(ws) {
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket message timeout')), 2000)
    ws.once('message', (data) => {
      clearTimeout(timer)
      resolve(JSON.parse(data.toString()))
    })
    ws.once('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

async function waitForCloseCode(ws) {
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket close timeout')), 2000)
    ws.once('close', (code) => {
      clearTimeout(timer)
      resolve(code)
    })
    ws.once('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

describe('Offline Sync Tombstone delta-sync and live WebSocket collaboration E2E workflow', () => {
  test('reconciles paginated workspace delta-sync across Notes, Notebooks, Folders, Flashcards, and Sync Tombstones while broadcasting live NOTE_UPDATED events and enforcing 1008 revocation', async (t) => {
    const actor = await seedUser(t)
    await actor.app.listen({ port: 0, host: '127.0.0.1' })
    const headers = { Authorization: `Bearer ${actor.accessToken}` }

    // 1. Seed initial resources prior to sync watermark
    const nbRes = await actor.app.inject({
      method: 'POST',
      url: '/notebooks',
      headers,
      payload: { name: 'Offline Sync NB' },
    })
    const notebook = nbRes.json().data

    const fldRes = await actor.app.inject({
      method: 'POST',
      url: `/notebooks/${notebook.id}/folders`,
      headers,
      payload: { name: 'Offline Folder' },
    })
    const folder = fldRes.json().data

    const doomedNoteRes = await actor.app.inject({
      method: 'POST',
      url: '/notes',
      headers,
      payload: { title: 'Note Deleted Offline', body: 'will become tombstone' },
    })
    const doomedNote = doomedNoteRes.json().data

    await delay(20)
    const watermarkIso = new Date().toISOString()
    await delay(20)

    // 2. Create a live Note, subscribe via WebSocket, and verify live broadcasts from both PUT /notes/:id and POST /flashcards/:id/review
    const liveNoteRes = await actor.app.inject({
      method: 'POST',
      url: '/notes',
      headers,
      payload: { title: 'Live Watched Note', body: 'v1' },
    })
    const liveNote = liveNoteRes.json().data

    const cardRes = await actor.app.inject({
      method: 'POST',
      url: '/flashcards',
      headers,
      payload: { noteId: liveNote.id, front: 'Sync Q', back: 'Sync A' },
    })
    const card = cardRes.json().data

    const ws = connectSocket(t, actor.app, liveNote.id, actor.accessToken)
    await waitForOpen(ws)

    // No-op autosave suppresses NOTE_UPDATED broadcast and keeps revision 1
    let unexpectedNoopFrame = false
    const onUnexpected = () => {
      unexpectedNoopFrame = true
    }
    ws.once('message', onUnexpected)
    const noopRes = await actor.app.inject({
      method: 'PUT',
      url: `/notes/${liveNote.id}`,
      headers,
      payload: { title: 'Live Watched Note', body: 'v1', expectedRevision: 1 },
    })
    assert.equal(noopRes.statusCode, 200)
    assert.equal(noopRes.json().data.revision, 1)
    await delay(120)
    ws.off('message', onUnexpected)
    assert.equal(unexpectedNoopFrame, false)

    const editFramePromise = readNextFrame(ws)
    const putRes = await actor.app.inject({
      method: 'PUT',
      url: `/notes/${liveNote.id}`,
      headers,
      payload: { title: 'Live Watched Note v2', body: 'v2', expectedRevision: 1 },
    })
    assert.equal(putRes.statusCode, 200)
    const editFrame = await editFramePromise
    assert.equal(editFrame.type, 'NOTE_UPDATED')
    assert.equal(editFrame.payload.revision, 2)
    assert.equal(editFrame.payload.title, 'Live Watched Note v2')

    // Reviewing a Flashcard promotes parent Note readiness ('to_review' -> 'in_progress') and broadcasts NOTE_UPDATED
    const reviewFramePromise = readNextFrame(ws)
    const reviewRes = await actor.app.inject({
      method: 'POST',
      url: `/flashcards/${card.id}/review`,
      headers,
      payload: { rating: 'good' },
    })
    assert.equal(reviewRes.statusCode, 200)
    const reviewFrame = await reviewFramePromise
    assert.equal(reviewFrame.type, 'NOTE_UPDATED')
    assert.equal(reviewFrame.payload.readiness, 'in_progress')
    assert.equal(reviewFrame.payload.revision, 3)

    // 3. Delete doomedNote, folder, and notebook to generate Sync Tombstones
    assert.equal(
      (
        await actor.app.inject({
          method: 'DELETE',
          url: `/notes/${doomedNote.id}?expectedRevision=1`,
          headers,
        })
      ).statusCode,
      204,
    )
    assert.equal(
      (
        await actor.app.inject({
          method: 'DELETE',
          url: `/notebooks/folders/${folder.id}`,
          headers,
        })
      ).statusCode,
      204,
    )
    assert.equal(
      (
        await actor.app.inject({
          method: 'DELETE',
          url: `/notebooks/${notebook.id}`,
          headers,
        })
      ).statusCode,
      204,
    )

    // 4. Reconcile workspace delta via paginated GET /notes/sync?since=...&limit=1
    const page1Res = await actor.app.inject({
      method: 'GET',
      url: `/notes/sync?since=${encodeURIComponent(watermarkIso)}&limit=1`,
      headers,
    })
    assert.equal(page1Res.statusCode, 200)
    const page1 = page1Res.json().data
    assert.equal(page1.hasMore, true)
    assert.ok(page1.nextCursor)

    // Collect remaining pages until hasMore === false
    const deletedNoteIds = [...page1.notes.deletedIds]
    const deletedFolderIds = [...page1.folders.deletedIds]
    const deletedNotebookIds = [...page1.notebooks.deletedIds]
    const upsertedNoteIds = page1.notes.upserted.map((n) => n.id)
    const upsertedCardIds = page1.flashcards.upserted.map((c) => c.id)

    let cursor = page1.nextCursor
    let hasMore = page1.hasMore
    while (hasMore) {
      const nextRes = await actor.app.inject({
        method: 'GET',
        url: `/notes/sync?since=${encodeURIComponent(watermarkIso)}&limit=5&cursor=${encodeURIComponent(cursor)}`,
        headers,
      })
      assert.equal(nextRes.statusCode, 200)
      const data = nextRes.json().data
      deletedNoteIds.push(...data.notes.deletedIds)
      deletedFolderIds.push(...data.folders.deletedIds)
      deletedNotebookIds.push(...data.notebooks.deletedIds)
      upsertedNoteIds.push(...data.notes.upserted.map((n) => n.id))
      upsertedCardIds.push(...data.flashcards.upserted.map((c) => c.id))
      cursor = data.nextCursor
      hasMore = data.hasMore
    }

    assert.ok(upsertedNoteIds.includes(liveNote.id))
    assert.ok(upsertedCardIds.includes(card.id))
    assert.ok(deletedNoteIds.includes(doomedNote.id))
    assert.ok(deletedFolderIds.includes(folder.id))
    assert.ok(deletedNotebookIds.includes(notebook.id))

    // 5. Credential rotation via PUT /users/me (email update increments credentialsVersion) revokes stale socket with 1008 on next note event
    const closePromise = waitForCloseCode(ws)
    const emailUpdateRes = await actor.app.inject({
      method: 'PUT',
      url: '/users/me',
      headers,
      payload: { email: randomEmail(10, 5) },
    })
    assert.equal(emailUpdateRes.statusCode, 200)

    const freshToken = actor.app.jwt.sign(
      {
        sub: actor.userId,
        username: actor.username,
        role: 'user',
        cv: 1,
        type: 'access',
      },
      { jti: randomUUIDv7(), expiresIn: '1h' },
    )
    const freshHeaders = { Authorization: `Bearer ${freshToken}` }

    const postRotatePutRes = await actor.app.inject({
      method: 'PUT',
      url: `/notes/${liveNote.id}`,
      headers: freshHeaders,
      payload: { title: 'Post-Rotation Edit', expectedRevision: 3 },
    })
    assert.equal(postRotatePutRes.statusCode, 200)
    assert.equal(await closePromise, 1008)

    // 6. Connect fresh socket and verify watched Note deletion closes socket with 1008
    const wsFresh = connectSocket(t, actor.app, liveNote.id, freshToken)
    await waitForOpen(wsFresh)
    const deleteClosePromise = waitForCloseCode(wsFresh)
    const deleteLiveRes = await actor.app.inject({
      method: 'DELETE',
      url: `/notes/${liveNote.id}?expectedRevision=4`,
      headers: freshHeaders,
    })
    assert.equal(deleteLiveRes.statusCode, 204)
    assert.equal(await deleteClosePromise, 1008)
  })
})
