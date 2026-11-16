'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUIDv7 } = require('node:crypto')
const { createNote } = require('../../utils/note-creator')
const { buildMarkdownNote } = require('../../utils/markdown-note')
const {
  getBrotliResponse,
  getDeflateResponse,
  getGzipResponse,
  listenOnRandomPort,
} = require('../../utils/http-compression')
const { seedUser } = require('../../utils/setup-user')

describe('GET /notes/:id', () => {
  test('returns 200 with full note details including readiness and noteType', async (t) => {
    // Arrange
    const { note, app, accessToken } = await createNote(t, {
      readiness: 'mastered',
      noteType: 'post_mortem',
    })

    // Act
    const response = await app.inject({
      method: 'GET',
      url: `/notes/${note.data.id}`,
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const body = response.json()
    assert.equal(body.data.id, note.data.id)
    assert.equal(body.data.title, note.data.title)
    assert.equal(body.data.body, note.data.body)
    assert.equal(body.data.readiness, 'mastered')
    assert.equal(body.data.noteType, 'post_mortem')
    assert.equal(body.data.revision, 1)
  })

  test('returns 200 preserving a large 32KB+ Markdown body unchanged', async (t) => {
    // Arrange
    const markdownBody = buildMarkdownNote({ minLength: 32_000 })
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
    assert.equal(response.statusCode, 200)
    const payload = response.json()
    assert.equal(payload.data.id, note.data.id)
    assert.equal(payload.data.body, markdownBody)
    assert.deepEqual(payload.data.tags, ['markdown', 'detail'])
  })

  test('returns 200 and serves repeated identical reads via bounded LRU cache', async (t) => {
    // Arrange
    const { note, app, accessToken, userId } = await createNote(t)
    await app.notesDataSource.readNote(note.data.id, userId)
    assert.ok(await app.cacheGet(`note:${note.data.id}:${userId}`))

    // Act
    const response = await app.inject({
      method: 'GET',
      url: `/notes/${note.data.id}`,
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.deepEqual(response.json(), note)
  })

  test('returns 200 compressed with gzip when requested over HTTP', async (t) => {
    // Arrange
    const markdownBody = buildMarkdownNote({ minLength: 32_000 })
    const { note, app, accessToken } = await createNote(t, {
      title: 'Compressed gzip note',
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
    assert.equal(response.statusCode, 200)
    assert.equal(response.headers['content-encoding'], 'gzip')
    const payload = JSON.parse(response.body)
    assert.deepEqual(payload, note)
    assert.ok(response.rawBody.length < Buffer.byteLength(response.body))
  })

  test('returns 200 compressed with brotli when requested over HTTP', async (t) => {
    // Arrange
    const markdownBody = buildMarkdownNote({ minLength: 32_000 })
    const { note, app, accessToken } = await createNote(t, {
      title: 'Compressed brotli note',
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
    assert.equal(response.statusCode, 200)
    assert.equal(response.headers['content-encoding'], 'br')
    const payload = JSON.parse(response.body)
    assert.deepEqual(payload, note)
    assert.ok(response.rawBody.length < Buffer.byteLength(response.body))
  })

  test('returns 200 compressed with deflate when requested over HTTP', async (t) => {
    // Arrange
    const markdownBody = buildMarkdownNote({ minLength: 32_000 })
    const { note, app, accessToken } = await createNote(t, {
      title: 'Compressed deflate note',
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
    assert.equal(response.statusCode, 200)
    assert.equal(response.headers['content-encoding'], 'deflate')
    const payload = JSON.parse(response.body)
    assert.deepEqual(payload, note)
    assert.ok(response.rawBody.length < Buffer.byteLength(response.body))
  })

  test('returns 400 when note id is not a valid UUID', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: '/notes/not-a-valid-uuid',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 401 when unauthenticated', async (t) => {
    // Arrange
    const { note, app } = await createNote(t)

    // Act
    const response = await app.inject({
      method: 'GET',
      url: `/notes/${note.data.id}`,
    })

    // Assert
    assert.equal(response.statusCode, 401)
  })

  test('returns 404 when note does not exist', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: `/notes/${randomUUIDv7()}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 404)
  })

  test('returns 404 when another user attempts to read the note', async (t) => {
    // Arrange
    const owner = await createNote(t)
    const intruder = await seedUser(t, { app: owner.app })

    // Act
    const response = await intruder.app.inject({
      method: 'GET',
      url: `/notes/${owner.note.data.id}`,
      headers: { Authorization: `Bearer ${intruder.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 404)
  })
})
