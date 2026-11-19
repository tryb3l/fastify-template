'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { once } = require('node:events')
const WebSocket = require('ws')
const { randomEmail } = require('../../utils/data-creator')
const { buildMarkdownNote } = require('../../utils/markdown-note')
const { seedUser } = require('../../utils/setup-user')

async function listenOnEphemeralPort(app) {
  await app.listen({ port: 0, host: '127.0.0.1' })
  const port = app.server.address().port
  return { port, isHttps: Boolean(app.initialConfig?.https) }
}

function connectLiveSocket(t, { port, isHttps }, noteId, headers = {}) {
  const protocol = isHttps ? 'wss' : 'ws'
  const ws = new WebSocket(`${protocol}://127.0.0.1:${port}/notes/live/${noteId}`, {
    ...(isHttps ? { rejectUnauthorized: false } : {}),
    headers,
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
  if (ws.readyState === WebSocket.OPEN) {
    return
  }
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket did not open in time')), 2000)
    ws.once('open', () => {
      clearTimeout(timer)
      resolve()
    })
    ws.once('unexpected-response', (_req, res) => {
      clearTimeout(timer)
      reject(new Error(`Unexpected response status: ${res.statusCode}`))
    })
    ws.once('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

async function readNextMessage(ws) {
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Timed out waiting for WebSocket message'))
    }, 2000)
    ws.once('message', (data) => {
      clearTimeout(timer)
      resolve(data.toString())
    })
    ws.once('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    ws.once('close', (code) => {
      clearTimeout(timer)
      reject(new Error(`WebSocket closed (${code}) before message was received`))
    })
  })
}

async function waitForClose(ws) {
  if (ws.readyState === WebSocket.CLOSED) {
    return ws._closeCode
  }
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Timed out waiting for WebSocket close'))
    }, 2000)
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

async function readUnexpectedUpgradeStatus(ws) {
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Timed out waiting for unexpected-response')),
      2000,
    )
    ws.once('unexpected-response', (_req, res) => {
      clearTimeout(timer)
      res.resume()
      resolve(res.statusCode)
    })
    ws.once('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

async function assertNoMessageWithin(ws, ms = 250) {
  await new Promise((resolve, reject) => {
    let settled = false
    const done = (err) => {
      if (settled) return
      settled = true
      if (err) reject(err)
      else resolve()
    }
    const timer = setTimeout(() => {
      ws.off('message', onMessage)
      ws.off('close', onClose)
      done()
    }, ms)
    function onMessage(data) {
      clearTimeout(timer)
      done(new Error(`Unexpected WebSocket message: ${data.toString()}`))
    }
    function onClose(code) {
      clearTimeout(timer)
      done(new Error(`WebSocket closed unexpectedly (${code})`))
    }
    ws.once('message', onMessage)
    ws.once('close', onClose)
  })
}

describe('GET /notes/live/:id', () => {
  test('returns 101 upgrade and replies pong to ping frame for owning user', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const note = await actor.app.notesDataSource.createNote(
      { title: 'Live Test Note', body: 'ws content' },
      actor.userId,
    )
    const server = await listenOnEphemeralPort(actor.app)
    const ws = connectLiveSocket(t, server, note.id, {
      Authorization: `Bearer ${actor.accessToken}`,
    })
    await waitForOpen(ws)

    // Act
    const messagePromise = readNextMessage(ws)
    ws.send('ping')
    const reply = await messagePromise

    // Assert
    assert.equal(reply, 'pong')
    ws.close()
    await once(ws, 'close')
  })

  test('returns 101 upgrade and broadcasts NOTE_UPDATED payload after owning user updates the watched note', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const note = await actor.app.notesDataSource.createNote(
      { title: 'Live Broadcast Note', body: 'initial' },
      actor.userId,
    )
    const markdownBody = buildMarkdownNote({ minLength: 32_000 })
    const server = await listenOnEphemeralPort(actor.app)
    const ws = connectLiveSocket(t, server, note.id, {
      Authorization: `Bearer ${actor.accessToken}`,
    })
    await waitForOpen(ws)

    // Act
    const messagePromise = readNextMessage(ws)
    const updatedNote = await actor.app.notesDataSource.updateNote(
      note.id,
      {
        title: 'Updated Live Note',
        body: markdownBody,
        tags: ['live', 'update'],
        expectedRevision: 1,
      },
      actor.userId,
    )
    const broadcast = JSON.parse(await messagePromise)

    // Assert
    assert.deepEqual(broadcast, {
      type: 'NOTE_UPDATED',
      payload: {
        id: updatedNote.id,
        title: updatedNote.title,
        body: updatedNote.body,
        tags: updatedNote.tags,
        readiness: updatedNote.readiness,
        noteType: updatedNote.noteType,
        revision: updatedNote.revision,
        modifiedAt: updatedNote.modifiedAt.toISOString(),
      },
    })
    ws.close()
    await once(ws, 'close')
  })

  test('returns 101 upgrade and broadcasts identical NOTE_UPDATED payload to multiple subscribers on the same note', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const note = await actor.app.notesDataSource.createNote(
      { title: 'Multi-Subscriber Note', body: 'initial' },
      actor.userId,
    )
    const server = await listenOnEphemeralPort(actor.app)
    const ws1 = connectLiveSocket(t, server, note.id, {
      Authorization: `Bearer ${actor.accessToken}`,
    })
    const ws2 = connectLiveSocket(t, server, note.id, {
      Authorization: `Bearer ${actor.accessToken}`,
    })
    await Promise.all([waitForOpen(ws1), waitForOpen(ws2)])

    // Act
    const p1 = readNextMessage(ws1)
    const p2 = readNextMessage(ws2)
    await actor.app.notesDataSource.updateNote(
      note.id,
      {
        title: 'Broadcast Once To All',
        body: 'updated body',
        expectedRevision: 1,
      },
      actor.userId,
    )
    const [msg1, msg2] = [JSON.parse(await p1), JSON.parse(await p2)]

    // Assert
    assert.deepEqual(msg1, msg2)
    assert.equal(msg1.type, 'NOTE_UPDATED')
    assert.equal(msg1.payload.title, 'Broadcast Once To All')
    assert.equal(msg1.payload.revision, 2)
    ws1.close()
    ws2.close()
    await Promise.all([once(ws1, 'close').catch(() => {}), once(ws2, 'close').catch(() => {})])
  })

  test('returns 1008 close code and stops delivering NOTE_UPDATED when credentialsVersion increments', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const note = await actor.app.notesDataSource.createNote(
      { title: 'Revocation Target Note', body: 'before rotation' },
      actor.userId,
    )
    const server = await listenOnEphemeralPort(actor.app)
    const staleWs = connectLiveSocket(t, server, note.id, {
      Authorization: `Bearer ${actor.accessToken}`,
    })
    await waitForOpen(staleWs)
    const receivedMessages = []
    staleWs.on('message', (msg) => receivedMessages.push(msg.toString()))
    const closePromise = waitForClose(staleWs)
    await actor.app.usersDataSource.updateUser(actor.userId, { email: randomEmail(10, 5) })

    // Act
    await actor.app.notesDataSource.updateNote(
      note.id,
      {
        title: 'Post-Rotation Confidential Edit',
        body: 'stale socket must never receive this',
        expectedRevision: 1,
      },
      actor.userId,
    )
    const closeCode = await closePromise

    // Assert
    assert.equal(closeCode, 1008)
    assert.deepEqual(receivedMessages, [])
  })

  test('returns 1008 close code when watched note is deleted', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const note = await actor.app.notesDataSource.createNote(
      { title: 'Delete Target Note', body: 'socket closes on delete' },
      actor.userId,
    )
    const server = await listenOnEphemeralPort(actor.app)
    const ws = connectLiveSocket(t, server, note.id, {
      Authorization: `Bearer ${actor.accessToken}`,
    })
    await waitForOpen(ws)
    const closePromise = waitForClose(ws)

    // Act
    await actor.app.notesDataSource.deleteNote(note.id, actor.userId, 1)
    const closeCode = await closePromise

    // Assert
    assert.equal(closeCode, 1008)
  })

  test('returns 401 rejecting WebSocket upgrade without access token', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const server = await listenOnEphemeralPort(actor.app)
    const ws = connectLiveSocket(t, server, 'fake-id')

    // Act
    const statusCode = await readUnexpectedUpgradeStatus(ws)

    // Assert
    assert.equal(statusCode, 401)
  })

  test('returns 400 rejecting authenticated WebSocket upgrade when :id is not a valid UUID', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const server = await listenOnEphemeralPort(actor.app)
    const ws = connectLiveSocket(t, server, 'not-a-valid-uuid', {
      Authorization: `Bearer ${actor.accessToken}`,
    })

    // Act
    const statusCode = await readUnexpectedUpgradeStatus(ws)

    // Assert
    assert.equal(statusCode, 400)
  })

  test('returns 403 rejecting cross-user WebSocket subscription', async (t) => {
    // Arrange
    const owner = await seedUser(t)
    const intruder = await seedUser(t, { app: owner.app })
    const privateNote = await owner.app.notesDataSource.createNote(
      { title: 'Private Note', body: 'do not leak' },
      owner.userId,
    )
    const server = await listenOnEphemeralPort(owner.app)
    const ws = connectLiveSocket(t, server, privateNote.id, {
      Authorization: `Bearer ${intruder.accessToken}`,
    })

    // Act
    const statusCode = await readUnexpectedUpgradeStatus(ws)

    // Assert
    assert.equal(statusCode, 403)
  })

  test('returns 101 upgrade and ignores updates to unrelated notes without emitting frames', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const otherUser = await seedUser(t, { app: actor.app })
    const watchedNote = await actor.app.notesDataSource.createNote(
      { title: 'Watched Note', body: 'content' },
      actor.userId,
    )
    const unrelatedNote = await otherUser.app.notesDataSource.createNote(
      { title: 'Unrelated Note', body: 'other' },
      otherUser.userId,
    )
    const server = await listenOnEphemeralPort(actor.app)
    const ws = connectLiveSocket(t, server, watchedNote.id, {
      Authorization: `Bearer ${actor.accessToken}`,
    })
    await waitForOpen(ws)

    // Act
    const silenceCheck = assertNoMessageWithin(ws, 250)
    await otherUser.app.notesDataSource.updateNote(
      unrelatedNote.id,
      { title: 'Other Edit', expectedRevision: 1 },
      otherUser.userId,
    )

    // Assert
    await silenceCheck
    ws.close()
    await once(ws, 'close').catch(() => {})
  })

  test('returns 101 upgrade and suppresses NOTE_UPDATED broadcast on no-op autosave', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const watchedNote = await actor.app.notesDataSource.createNote(
      { title: 'Watched Note', body: 'unchanged content' },
      actor.userId,
    )
    const server = await listenOnEphemeralPort(actor.app)
    const ws = connectLiveSocket(t, server, watchedNote.id, {
      Authorization: `Bearer ${actor.accessToken}`,
    })
    await waitForOpen(ws)

    // Act
    const silenceCheck = assertNoMessageWithin(ws, 250)
    const noopResult = await actor.app.notesDataSource.updateNote(
      watchedNote.id,
      { title: 'Watched Note', body: 'unchanged content', expectedRevision: 1 },
      actor.userId,
    )

    // Assert
    assert.equal(noopResult.revision, 1)
    await silenceCheck
    ws.close()
    await once(ws, 'close').catch(() => {})
  })
})
