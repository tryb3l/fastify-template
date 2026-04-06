'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { setup } = require('../../../utils/setup-user')
const { randomUsername, randomEmail, randomPassword } = require('../../../utils/data-creator')
const WebSocket = require('ws')

async function listenOnRandomPort(app) {
  await app.listen({ port: 0 })
  return app.server.address().port
}

async function createOwnedNote(app, accessToken, payload = { title: 'Live Test Note', body: 'ws content' }) {
  const response = await app.inject({
    method: 'POST',
    url: '/notes',
    headers: { Authorization: `Bearer ${accessToken}` },
    payload,
  })

  assert.strictEqual(response.statusCode, 201)
  return response.json().data.id
}

async function createAuthenticatedUser(app) {
  const username = randomUsername(12)
  const email = randomEmail(10, 5)
  const password = randomPassword(15)

  const registerResponse = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { username, email, password },
  })
  assert.strictEqual(registerResponse.statusCode, 201)

  const loginResponse = await app.inject({
    method: 'POST',
    url: '/auth/authenticate',
    payload: { username, password },
  })
  assert.strictEqual(loginResponse.statusCode, 200)

  return {
    accessToken: loginResponse.json().access_token,
    userId: loginResponse.json().user.id,
  }
}

async function waitForSocketOpen(ws) {
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('WebSocket did not open in time'))
    }, 2000)

    if (ws.readyState === WebSocket.OPEN) {
      clearTimeout(timer)
      resolve()
      return
    }

    ws.once('open', () => {
      clearTimeout(timer)
      resolve()
    })

    ws.once('unexpected-response', (_req, res) => {
      clearTimeout(timer)
      reject(new Error(`Unexpected response status: ${res.statusCode}`))
    })

    ws.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

async function sendPingAndReadMessage(ws) {
  return await new Promise((resolve, reject) => {
    let receivedMessage = null

    ws.on('open', () => {
      ws.send('ping')
    })

    ws.on('message', (message) => {
      receivedMessage = message.toString()
      ws.close()
    })

    ws.on('unexpected-response', (_req, res) => {
      reject(new Error(`Unexpected response status: ${res.statusCode}`))
    })

    ws.on('close', () => {
      if (receivedMessage === null) {
        reject(new Error('WebSocket closed before a message was received'))
        return
      }

      resolve(receivedMessage)
    })

    ws.on('error', reject)
  })
}

async function readJsonMessageAndClose(ws) {
  return await new Promise((resolve, reject) => {
    let receivedMessage = null
    const timer = setTimeout(() => {
      ws.close()
      reject(new Error('Timed out waiting for websocket message'))
    }, 2000)

    ws.on('message', (message) => {
      try {
        receivedMessage = JSON.parse(message.toString())
        ws.close()
      } catch (error) {
        clearTimeout(timer)
        reject(error)
      }
    })

    ws.on('unexpected-response', (_req, res) => {
      clearTimeout(timer)
      reject(new Error(`Unexpected response status: ${res.statusCode}`))
    })

    ws.on('close', () => {
      clearTimeout(timer)
      if (receivedMessage === null) {
        reject(new Error('WebSocket closed before a message was received'))
        return
      }

      resolve(receivedMessage)
    })

    ws.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

async function assertNoSocketMessageWithin(ws, timeoutMs = 300) {
  return await new Promise((resolve, reject) => {
    let closedByTest = false
    let settled = false

    const finish = (callback) => {
      if (settled) return
      settled = true
      callback()
    }

    const timer = setTimeout(() => {
      closedByTest = true
      ws.close()
    }, timeoutMs)

    ws.once('message', (message) => {
      clearTimeout(timer)
      finish(() => reject(new Error(`Unexpected websocket message: ${message.toString()}`)))
    })

    ws.once('unexpected-response', (_req, res) => {
      clearTimeout(timer)
      finish(() => reject(new Error(`Unexpected response status: ${res.statusCode}`)))
    })

    ws.once('error', (error) => {
      clearTimeout(timer)
      finish(() => reject(error))
    })

    ws.once('close', () => {
      clearTimeout(timer)
      if (!closedByTest) {
        finish(() => reject(new Error('WebSocket closed before timeout elapsed')))
        return
      }

      finish(resolve)
    })
  })
}

async function readUnexpectedResponseStatus(ws) {
  return await new Promise((resolve, reject) => {
    let settled = false

    ws.on('unexpected-response', (_req, res) => {
      settled = true
      resolve(res.statusCode)
    })

    ws.on('error', (error) => {
      if (!settled) {
        reject(error)
      }
    })
  })
}

test('WS /notes/:id/live 101 - Authorized owner receives ping/pong on own note', async (t) => {
  // Arrange
  const { app, accessToken } = await setup(t, 'user')
  const port = await listenOnRandomPort(app)
  const noteId = await createOwnedNote(app, accessToken)

  // Act
  const ws = new WebSocket(`ws://localhost:${port}/notes/live/${noteId}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  })
  const message = await sendPingAndReadMessage(ws)

  // Assert
  assert.strictEqual(message, 'pong')
})

test('WS /notes/:id/live 401 - Rejects upgrade without access token', async (t) => {
  // Arrange
  const { app } = await setup(t, 'user')
  const port = await listenOnRandomPort(app)

  // Act
  const ws = new WebSocket(`ws://localhost:${port}/notes/live/fake-id`)
  const statusCode = await readUnexpectedResponseStatus(ws)

  // Assert
  assert.strictEqual(statusCode, 401, 'Unauthenticated connections must be rejected')
})

test('WS /notes/:id/live broadcasts NOTE_UPDATED payload after note change', async (t) => {
  // Arrange
  const { app, accessToken } = await setup(t, 'user')
  const port = await listenOnRandomPort(app)
  const noteId = await createOwnedNote(app, accessToken)
  const updatePayload = {
    title: 'Updated Live Note',
    body: 'broadcast body',
    tags: ['live', 'update']
  }
  const ws = new WebSocket(`ws://localhost:${port}/notes/live/${noteId}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  })

  await waitForSocketOpen(ws)

  // Act
  const broadcastPromise = readJsonMessageAndClose(ws)
  const updateResponse = await app.inject({
    method: 'PUT',
    url: `/notes/${noteId}`,
    headers: { Authorization: `Bearer ${accessToken}` },
    payload: updatePayload,
  })
  const broadcast = await broadcastPromise

  // Assert
  assert.strictEqual(updateResponse.statusCode, 200)

  const updatedNote = updateResponse.json().data
  assert.deepStrictEqual(broadcast, {
    type: 'NOTE_UPDATED',
    payload: {
      id: updatedNote.id,
      title: updatedNote.title,
      body: updatedNote.body,
      tags: updatedNote.tags,
      modifiedAt: updatedNote.modifiedAt,
    }
  })
})

test('WS /notes/:id/live ignores updates for a different users different note', async (t) => {
  // Arrange
  const { app, accessToken } = await setup(t, 'user')
  const otherUser = await createAuthenticatedUser(app)
  const port = await listenOnRandomPort(app)
  const watchedNoteId = await createOwnedNote(app, accessToken, {
    title: 'Watched Note',
    body: 'watch me'
  })
  const unrelatedNoteId = await createOwnedNote(app, otherUser.accessToken, {
    title: 'Unrelated Note',
    body: 'do not broadcast'
  })
  const ws = new WebSocket(`ws://localhost:${port}/notes/live/${watchedNoteId}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  })

  await waitForSocketOpen(ws)

  // Act
  const noMessagePromise = assertNoSocketMessageWithin(ws)
  const updateResponse = await app.inject({
    method: 'PUT',
    url: `/notes/${unrelatedNoteId}`,
    headers: { Authorization: `Bearer ${otherUser.accessToken}` },
    payload: {
      title: 'Unrelated Note Updated',
      body: 'still do not broadcast',
      tags: ['other-user']
    },
  })

  // Assert
  assert.strictEqual(updateResponse.statusCode, 200)
  await noMessagePromise
})

test('WS /notes/:id/live 403 - Blocks cross-user subscription to another users note', async (t) => {
  // Arrange
  const ownerCtx = await setup(t, 'user')
  const intruderCtx = await setup(t, 'user')
  const privateNoteId = await createOwnedNote(ownerCtx.app, ownerCtx.accessToken, {
    title: 'Private Note',
    body: 'do not leak'
  })
  const port = await listenOnRandomPort(ownerCtx.app)

  // Act
  const ws = new WebSocket(`ws://localhost:${port}/notes/live/${privateNoteId}`, {
    headers: { Authorization: `Bearer ${intruderCtx.accessToken}` }
  })
  const statusCode = await readUnexpectedResponseStatus(ws)

  // Assert
  assert.strictEqual(statusCode, 403, 'Cross-user subscription must be forbidden')
})
