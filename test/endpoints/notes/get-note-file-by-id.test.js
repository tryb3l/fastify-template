'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUIDv7 } = require('node:crypto')
const { createNote } = require('../../utils/note-creator')
const { buildWavBuffer, uploadNoteAttachment } = require('../../utils/notes-files')
const { seedUser } = require('../../utils/setup-user')

describe('GET /files/:fileId', () => {
  test('returns 200 streaming uncompressed bytes with ETag, Last-Modified, Accept-Ranges, and exact Content-Length', async (t) => {
    // Arrange
    const { app, accessToken, note } = await createNote(t)
    const content = '0123456789ABCDEF'.repeat(128) // 2048 bytes (> 1024 compression threshold)
    const { uploadedFile } = await uploadNoteAttachment(
      app,
      accessToken,
      note.data.id,
      content,
      { filename: 'uncompressed.txt', contentType: 'text/plain' },
      t,
    )

    // Act
    const response = await app.inject({
      method: 'GET',
      url: `/files/${uploadedFile.fileId}?noteId=${note.data.id}`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Accept-Encoding': 'br, gzip, deflate',
      },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.equal(response.headers['content-encoding'], undefined)
    assert.equal(response.headers['accept-ranges'], 'bytes')
    assert.equal(Number(response.headers['content-length']), content.length)
    assert.match(response.headers['etag'], /^W\/"/)
    assert.equal(response.headers['cache-control'], 'private, no-cache')
    assert.ok(!Number.isNaN(Date.parse(response.headers['last-modified'])))
    assert.equal(response.body, content)
  })

  test('returns 200 sanitizing unsafe characters from Content-Disposition filename', async (t) => {
    // Arrange
    const { app, accessToken, note } = await createNote(t)
    const { uploadedFile } = await uploadNoteAttachment(
      app,
      accessToken,
      note.data.id,
      'sanitized-name-test',
      { filename: 'sanitize-source.txt', contentType: 'text/plain' },
      t,
    )
    await app.mongo.db
      .collection('notes')
      .updateOne(
        { id: note.data.id, 'attachments.fileId': uploadedFile.fileId },
        { $set: { 'attachments.$.originalFilename': 'folder\\report"2026\r\nevil.txt' } },
      )

    // Act
    const response = await app.inject({
      method: 'GET',
      url: `/files/${uploadedFile.fileId}?noteId=${note.data.id}`,
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const filename = response.headers['content-disposition'].match(
      /^attachment; filename="(.+)"$/,
    )?.[1]
    assert.ok(filename)
    assert.ok(!filename.includes('"'))
    assert.ok(!filename.includes('\\'))
    assert.ok(!filename.includes('\r'))
    assert.ok(!filename.includes('\n'))
  })

  test('returns 200 falling back to "attachment" when filename has only unsafe characters', async (t) => {
    // Arrange
    const { app, accessToken, note } = await createNote(t)
    const { uploadedFile, serverPath } = await uploadNoteAttachment(
      app,
      accessToken,
      note.data.id,
      'fallback-name-test',
      { filename: 'blank-fallback-source.txt', contentType: 'text/plain' },
      t,
    )
    const extensionlessPath = path.join(app.notesFileManager.uploadDir, uploadedFile.fileId)
    await fs.copyFile(serverPath, extensionlessPath)
    t.after(async () => {
      await fs.unlink(extensionlessPath).catch(() => {})
    })
    await app.mongo.db
      .collection('notes')
      .updateOne(
        { id: note.data.id, 'attachments.fileId': uploadedFile.fileId },
        { $set: { 'attachments.$.originalFilename': '\\\r\n"   ' } },
      )

    // Act
    const response = await app.inject({
      method: 'GET',
      url: `/files/${uploadedFile.fileId}?noteId=${note.data.id}`,
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.equal(response.headers['content-disposition'], 'attachment; filename="attachment"')
  })

  test('returns 200 preferring If-None-Match over If-Modified-Since when ETag mismatches', async (t) => {
    // Arrange
    const { app, accessToken, userId, note } = await createNote(t)
    const fileContent = 'precedence-content'
    const { uploadedFile } = await uploadNoteAttachment(
      app,
      accessToken,
      note.data.id,
      fileContent,
      { filename: 'conditional-precedence.txt', contentType: 'text/plain' },
      t,
    )
    const persisted = await app.notesDataSource.readNote(note.data.id, userId)
    const download = await app.notesFileManager.resolveAttachmentDownload(
      persisted,
      uploadedFile.fileId,
      {},
    )

    // Act
    const response = await app.inject({
      method: 'GET',
      url: `/files/${uploadedFile.fileId}?noteId=${note.data.id}`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'if-none-match': 'W/"not-the-current-etag"',
        'if-modified-since': download.lastModified,
      },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.equal(response.body, fileContent)
  })

  test('returns 206 Partial Content for explicit byte ranges on uncompressed media', async (t) => {
    // Arrange
    const { app, accessToken, note } = await createNote(t)
    const wavBuffer = buildWavBuffer(192) // 236 bytes
    const { uploadedFile } = await uploadNoteAttachment(
      app,
      accessToken,
      note.data.id,
      wavBuffer,
      { filename: 'meeting-note.wav', contentType: 'audio/wav' },
      t,
    )

    // Act
    const response = await app.inject({
      method: 'GET',
      url: `/files/${uploadedFile.fileId}?noteId=${note.data.id}`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Accept-Encoding': 'br, gzip, deflate',
        Range: 'bytes=0-11',
      },
    })

    // Assert
    assert.equal(response.statusCode, 206)
    assert.equal(response.headers['content-encoding'], undefined)
    assert.equal(response.headers['content-type'], 'audio/wav')
    assert.equal(response.headers['accept-ranges'], 'bytes')
    assert.equal(response.headers['content-range'], `bytes 0-11/${wavBuffer.length}`)
    assert.equal(Number(response.headers['content-length']), 12)
    assert.equal(response.rawPayload.subarray(0, 4).toString('ascii'), 'RIFF')
    assert.equal(response.rawPayload.subarray(8, 12).toString('ascii'), 'WAVE')
  })

  test('returns 206 Partial Content for suffix HTTP byte ranges', async (t) => {
    // Arrange
    const { app, accessToken, note } = await createNote(t)
    const content = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ' // 36 bytes
    const { uploadedFile } = await uploadNoteAttachment(
      app,
      accessToken,
      note.data.id,
      content,
      { filename: 'range-suffix.txt', contentType: 'text/plain' },
      t,
    )

    // Act
    const suffixRes = await app.inject({
      method: 'GET',
      url: `/files/${uploadedFile.fileId}?noteId=${note.data.id}`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Range: 'bytes=-4',
      },
    })

    // Assert
    assert.equal(suffixRes.statusCode, 206)
    assert.equal(
      suffixRes.headers['content-range'],
      `bytes ${content.length - 4}-${content.length - 1}/${content.length}`,
    )
    assert.equal(suffixRes.body, 'WXYZ')
  })

  test('returns 206 Partial Content for open-ended HTTP byte ranges', async (t) => {
    // Arrange
    const { app, accessToken, note } = await createNote(t)
    const content = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ' // 36 bytes
    const { uploadedFile } = await uploadNoteAttachment(
      app,
      accessToken,
      note.data.id,
      content,
      { filename: 'range-open.txt', contentType: 'text/plain' },
      t,
    )

    // Act
    const openEndedRes = await app.inject({
      method: 'GET',
      url: `/files/${uploadedFile.fileId}?noteId=${note.data.id}`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Range: 'bytes=30-',
      },
    })

    // Assert
    assert.equal(openEndedRes.statusCode, 206)
    assert.equal(
      openEndedRes.headers['content-range'],
      `bytes 30-${content.length - 1}/${content.length}`,
    )
    assert.equal(openEndedRes.body, 'UVWXYZ')
  })

  test('returns 304 on matching If-None-Match ETag', async (t) => {
    // Arrange
    const { app, accessToken, userId, note } = await createNote(t)
    const { uploadedFile } = await uploadNoteAttachment(
      app,
      accessToken,
      note.data.id,
      'conditional-content',
      { filename: 'conditional-etag.txt', contentType: 'text/plain' },
      t,
    )
    const persisted = await app.notesDataSource.readNote(note.data.id, userId)
    const { etag, lastModified } = await app.notesFileManager.resolveAttachmentDownload(
      persisted,
      uploadedFile.fileId,
      {},
    )

    // Act
    const response = await app.inject({
      method: 'GET',
      url: `/files/${uploadedFile.fileId}?noteId=${note.data.id}`,
      headers: { Authorization: `Bearer ${accessToken}`, 'if-none-match': etag },
    })

    // Assert
    assert.equal(response.statusCode, 304)
    assert.equal(response.body, '')
    assert.equal(response.headers['etag'], etag)
    assert.equal(response.headers['last-modified'], lastModified)
    assert.equal(response.headers['cache-control'], 'private, no-cache')
  })

  test('returns 304 on matching If-Modified-Since header', async (t) => {
    // Arrange
    const { app, accessToken, userId, note } = await createNote(t)
    const { uploadedFile } = await uploadNoteAttachment(
      app,
      accessToken,
      note.data.id,
      'ims-content',
      { filename: 'conditional-ims.txt', contentType: 'text/plain' },
      t,
    )
    const persisted = await app.notesDataSource.readNote(note.data.id, userId)
    const { lastModified } = await app.notesFileManager.resolveAttachmentDownload(
      persisted,
      uploadedFile.fileId,
      {},
    )

    // Act
    const response = await app.inject({
      method: 'GET',
      url: `/files/${uploadedFile.fileId}?noteId=${note.data.id}`,
      headers: { Authorization: `Bearer ${accessToken}`, 'if-modified-since': lastModified },
    })

    // Assert
    assert.equal(response.statusCode, 304)
    assert.equal(response.headers['last-modified'], lastModified)
    assert.equal(response.headers['cache-control'], 'private, no-cache')
    assert.equal(response.body, '')
  })

  test('returns 400 when fileId or noteId is not a valid UUID', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'GET',
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
      'private-download',
      { filename: 'private-download.txt', contentType: 'text/plain' },
      t,
    )

    // Act
    const response = await app.inject({
      method: 'GET',
      url: `/files/${uploadedFile.fileId}?noteId=${note.data.id}`,
    })

    // Assert
    assert.equal(response.statusCode, 401)
  })

  test('returns 404 when fileId is not attached to the note', async (t) => {
    // Arrange
    const { app, accessToken, note } = await createNote(t)

    // Act
    const response = await app.inject({
      method: 'GET',
      url: `/files/${randomUUIDv7()}?noteId=${note.data.id}`,
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 404)
  })

  test('returns 404 when Note does not exist', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: `/files/${randomUUIDv7()}?noteId=${randomUUIDv7()}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 404)
  })

  test('returns 404 when another user attempts to download the attachment', async (t) => {
    // Arrange
    const owner = await createNote(t)
    const intruder = await seedUser(t, { app: owner.app })
    const { uploadedFile } = await uploadNoteAttachment(
      owner.app,
      owner.accessToken,
      owner.note.data.id,
      'owner-secret',
      { filename: 'owners-secret.txt', contentType: 'text/plain' },
      t,
    )

    // Act
    const response = await intruder.app.inject({
      method: 'GET',
      url: `/files/${uploadedFile.fileId}?noteId=${owner.note.data.id}`,
      headers: { Authorization: `Bearer ${intruder.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 404)
  })

  test('returns 416 Range Not Satisfiable with Content-Range bytes */size when range is out of bounds', async (t) => {
    // Arrange
    const { app, accessToken, note } = await createNote(t)
    const content = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    const { uploadedFile } = await uploadNoteAttachment(
      app,
      accessToken,
      note.data.id,
      content,
      { filename: 'range-test.txt', contentType: 'text/plain' },
      t,
    )

    // Act
    const response = await app.inject({
      method: 'GET',
      url: `/files/${uploadedFile.fileId}?noteId=${note.data.id}`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Range: 'bytes=500-600',
      },
    })

    // Assert
    assert.equal(response.statusCode, 416)
    assert.equal(response.headers['content-range'], `bytes */${content.length}`)
  })

  test('strips undeclared query parameters via schema additionalProperties: false and attaches rate-limit headers', async (t) => {
    // Arrange
    const { app, accessToken, note } = await createNote(t)
    const { uploadedFile } = await uploadNoteAttachment(
      app,
      accessToken,
      note.data.id,
      'strict-query-test',
      { filename: 'strict-query.txt', contentType: 'text/plain' },
      t,
    )

    // Act
    const response = await app.inject({
      method: 'GET',
      url: `/files/${uploadedFile.fileId}?noteId=${note.data.id}&unexpectedParam=ignored`,
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.equal(response.body, 'strict-query-test')
    assert.equal(response.headers['x-ratelimit-limit'], '120')
  })
})
