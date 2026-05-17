'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { createNote } = require('../../../../utils/note-creator')
const { randomString } = require('../../../../utils/data-creator')
const { randomUUIDv7 } = require('node:crypto')
const { setup } = require('../../../../utils/setup-user')
const { buildMarkdownNote } = require('../../../../utils/markdown-note')
const {
  getBrotliResponse,
  getDeflateResponse,
  getGzipResponse,
  listenOnRandomPort,
} = require('../../../../utils/http-compression')

test('GET by id /notes/:id 200 - Fetch note by id', async (t) => {
  // Arrange
  const { note, app, accessToken } = await createNote(t)

  // Act
  const response = await app.inject({
    method: 'GET',
    url: `/notes/${note.data.id}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  assert.strictEqual(response.statusCode, 200)
  const body = response.json()
  assert.strictEqual(body.data.id, note.data.id)
  assert.strictEqual(body.data.title, note.data.title)
  assert.strictEqual(body.data.body, note.data.body)
})

test('GET by id /notes/:id 200 - Fetches a large markdown body unchanged', async (t) => {
  // Arrange
  const markdownBody = buildMarkdownNote({ minLength: 32000 })
  const { note, app, accessToken } = await createNote(t, {
    title: 'Milkdown detail note',
    body: markdownBody,
    tags: ['markdown', 'detail'],
  })

  // Act
  const response = await app.inject({
    method: 'GET',
    url: `/notes/${note.data.id}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  assert.strictEqual(response.statusCode, 200)
  const payload = response.json()
  assert.strictEqual(payload.data.id, note.data.id)
  assert.strictEqual(payload.data.body, markdownBody)
  assert.deepStrictEqual(payload.data.tags, ['markdown', 'detail'])
})

test('GET by id /notes/:id 200 - Compresses large markdown responses over HTTP when gzip is requested', async (t) => {
  // Arrange
  const markdownBody = buildMarkdownNote({ minLength: 32000 })
  const { note, app, accessToken } = await createNote(t, {
    title: 'Compressed detail note',
    body: markdownBody,
    tags: ['markdown', 'gzip'],
  })
  const port = await listenOnRandomPort(app)

  // Act
  const response = await getGzipResponse({
    port,
    path: `/notes/${note.data.id}`,
    accessToken,
  })

  // Assert
  assert.strictEqual(response.statusCode, 200)
  assert.strictEqual(response.headers['content-encoding'], 'gzip')

  const payload = JSON.parse(response.body)
  assert.strictEqual(payload.data.id, note.data.id)
  assert.strictEqual(payload.data.body, markdownBody)
  assert.ok(response.rawBody.length < Buffer.byteLength(response.body))
})

test('GET by id /notes/:id 200 - Compresses large markdown responses over HTTP when brotli is requested', async (t) => {
  // Arrange
  const markdownBody = buildMarkdownNote({ minLength: 32000 })
  const { note, app, accessToken } = await createNote(t, {
    title: 'Compressed brotli detail note',
    body: markdownBody,
    tags: ['markdown', 'brotli'],
  })
  const port = await listenOnRandomPort(app)

  // Act
  const response = await getBrotliResponse({
    port,
    path: `/notes/${note.data.id}`,
    accessToken,
  })

  // Assert
  assert.strictEqual(response.statusCode, 200)
  assert.strictEqual(response.headers['content-encoding'], 'br')

  const payload = JSON.parse(response.body)
  assert.deepStrictEqual(payload, note)
  assert.ok(response.rawBody.length < Buffer.byteLength(response.body))
})

test('GET by id /notes/:id 200 - Compresses large markdown responses over HTTP when deflate is requested', async (t) => {
  // Arrange
  const markdownBody = buildMarkdownNote({ minLength: 32000 })
  const { note, app, accessToken } = await createNote(t, {
    title: 'Compressed deflate detail note',
    body: markdownBody,
    tags: ['markdown', 'deflate'],
  })
  const port = await listenOnRandomPort(app)

  // Act
  const response = await getDeflateResponse({
    port,
    path: `/notes/${note.data.id}`,
    accessToken,
  })

  // Assert
  assert.strictEqual(response.statusCode, 200)
  assert.strictEqual(response.headers['content-encoding'], 'deflate')

  const payload = JSON.parse(response.body)
  assert.deepStrictEqual(payload, note)
  assert.ok(response.rawBody.length < Buffer.byteLength(response.body))
})

test('GET by id /notes/:id 404 - Note not found', async (t) => {
  // Arrange
  const { app, accessToken } = await createNote(t)
  const nonExistentNoteId = randomUUIDv7()

  // Act
  const response = await app.inject({
    method: 'GET',
    url: `/notes/${nonExistentNoteId}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  assert.strictEqual(response.statusCode, 404)
})

test('GET by id /notes/:id 404 - Different user cannot read another users note', async (t) => {
  // Arrange
  const owner = await createNote(t)
  const intruder = await setup(t, 'user')

  // Act
  const response = await intruder.app.inject({
    method: 'GET',
    url: `/notes/${owner.note.data.id}`,
    headers: { Authorization: `Bearer ${intruder.accessToken}` },
  })

  // Assert
  assert.strictEqual(response.statusCode, 404)

  const ownerVerify = await owner.app.inject({
    method: 'GET',
    url: `/notes/${owner.note.data.id}`,
    headers: { Authorization: `Bearer ${owner.accessToken}` },
  })

  assert.strictEqual(ownerVerify.statusCode, 200)
})

test('GET by id /notes/:id 400 - Invalid id format', async (t) => {
  // Arrange
  const { app, accessToken } = await createNote(t)
  const invalidNoteId = randomString('1234567890', 10)

  // Act
  const response = await app.inject({
    method: 'GET',
    url: `/notes/${invalidNoteId}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  assert.strictEqual(response.statusCode, 400)
})

test('GET by id /notes/:id 401 - Unauthorized when no token is provided', async (t) => {
  // Arrange
  const { note, app } = await createNote(t)

  // Act
  const response = await app.inject({
    method: 'GET',
    url: `/notes/${note.data.id}`,
    // No Authorization header
  })

  // Assert
  assert.strictEqual(response.statusCode, 401)
})
