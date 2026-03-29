'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { setup } = require('../../../utils/setup-user')
const WebSocket = require('ws')

test('WS /notes/:id/live 101 - Authorized owner receives ping/pong on own note', async (t) => {
  // Arrange
  const { app, accessToken } = await setup(t, 'user')
  await app.listen({ port: 0 })
  const port = app.server.address().port

  const createRes = await app.inject({
    method: 'POST',
    url: '/notes',
    headers: { Authorization: `Bearer ${accessToken}` },
    payload: { title: 'Live Test Note', body: 'ws content' }
  })
  assert.strictEqual(createRes.statusCode, 201)
  const noteId = createRes.json().data.id

  // Act
  const ws = new WebSocket(`ws://localhost:${port}/notes/live/${noteId}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  })

  await new Promise((resolve, reject) => {
    ws.on('open', () => {
      ws.send('ping')
    })

    // Assert
    ws.on('message', (message) => {
      assert.strictEqual(message.toString(), 'pong')
      ws.close()
    })

    ws.on('close', resolve)
    ws.on('error', reject)
  })
})

test('WS /notes/:id/live 401 - Rejects upgrade without access token', async (t) => {
  // Arrange
  const { app } = await setup(t, 'user')

  await app.listen({ port: 0 })
  const port = app.server.address().port

  // Act
  const ws = new WebSocket(`ws://localhost:${port}/notes/live/fake-id`)

  // Assert
  await new Promise((resolve) => {
    ws.on('unexpected-response', (_req, res) => {
      assert.strictEqual(res.statusCode, 401, 'Unauthenticated connections must be rejected')
      resolve()
    })
    ws.on('error', () => resolve())
  })
})

test('WS /notes/:id/live 403 - Blocks cross-user subscription to another users note', async (t) => {
  // Arrange
  const ownerCtx = await setup(t, 'user')
  const intruderCtx = await setup(t, 'user')

  const createRes = await ownerCtx.app.inject({
    method: 'POST',
    url: '/notes',
    headers: { Authorization: `Bearer ${ownerCtx.accessToken}` },
    payload: { title: 'Private Note', body: 'do not leak' }
  })
  assert.strictEqual(createRes.statusCode, 201)
  const privateNoteId = createRes.json().data.id

  await intruderCtx.app.listen({ port: 0 })
  const port = intruderCtx.app.server.address().port

  // Act
  const ws = new WebSocket(`ws://localhost:${port}/notes/live/${privateNoteId}`, {
    headers: { Authorization: `Bearer ${intruderCtx.accessToken}` }
  })

  // Assert
  await new Promise((resolve) => {
    ws.on('unexpected-response', (_req, res) => {
      assert.strictEqual(res.statusCode, 403, 'Cross-user subscription must be forbidden')
      resolve()
    })
    ws.on('error', () => resolve())
  })
})
