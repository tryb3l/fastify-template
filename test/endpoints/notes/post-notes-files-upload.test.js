'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUIDv7 } = require('node:crypto')
const fs = require('node:fs/promises')
const FormData = require('form-data')
const { createNote } = require('../../utils/note-creator')
const {
  PNG_SAMPLE,
  buildUploadForm,
  buildWavBuffer,
  fileExists,
  registerAttachmentCleanup,
} = require('../../utils/notes-files')
const { seedUser } = require('../../utils/setup-user')

describe('POST /files/upload', () => {
  test('returns 201, saves attachment to disk, invalidates Note cache, and increments revision', async (t) => {
    // Arrange
    const { app, accessToken, userId, note } = await createNote(t)
    await app.notesDataSource.readNote(note.data.id, userId)
    assert.ok(await app.cacheGet(`note:${note.data.id}:${userId}`))

    const form = buildUploadForm('Hello, raw attachment upload!', {
      filename: 'test-upload-file.txt',
      contentType: 'text/plain',
    })

    // Act
    const response = await app.inject({
      method: 'POST',
      url: `/files/upload?noteId=${note.data.id}`,
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${accessToken}`,
      },
      payload: form,
    })

    // Assert
    assert.equal(response.statusCode, 201)
    const body = response.json()
    assert.equal(body.message, 'Files uploaded successfully')
    assert.equal(body.files.length, 1)
    const uploadedFile = body.files[0]
    const serverPath = registerAttachmentCleanup(t, {
      ...uploadedFile,
      uploadDir: app.notesFileManager.uploadDir,
    })
    assert.equal(await fileExists(serverPath), true)
    assert.equal(uploadedFile.originalFilename, 'test-upload-file.txt')
    assert.equal(uploadedFile.mimeType, 'text/plain')
    assert.equal(await app.cacheGet(`note:${note.data.id}:${userId}`), null)

    const refreshedRead = await app.notesDataSource.readNote(note.data.id, userId)
    assert.equal(refreshedRead.revision, note.data.revision + 1)
    assert.equal(refreshedRead.attachments.length, 1)
  })

  test('returns 201 for valid UTF-8 CSV upload', async (t) => {
    // Arrange
    const { app, accessToken, note } = await createNote(t)
    const form = buildUploadForm('title,body\nAlpha,Beta\n', {
      filename: 'note-import.csv',
      contentType: 'text/csv',
    })

    // Act
    const response = await app.inject({
      method: 'POST',
      url: `/files/upload?noteId=${note.data.id}`,
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${accessToken}`,
      },
      payload: form,
    })

    // Assert
    assert.equal(response.statusCode, 201)
    const uploaded = response.json().files[0]
    const serverPath = registerAttachmentCleanup(t, {
      ...uploaded,
      uploadDir: app.notesFileManager.uploadDir,
    })
    assert.equal(await fileExists(serverPath), true)
    assert.equal(uploaded.mimeType, 'text/csv')
  })

  test('returns 201 when uploading to a Note via audio/mp4 or video/mp4 magic bytes', async (t) => {
    // Arrange
    const { app, accessToken, note } = await createNote(t)
    const mp4Header = Buffer.from([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32, 0x00, 0x00, 0x00,
      0x00, 0x6d, 0x70, 0x34, 0x32, 0x69, 0x73, 0x6f, 0x6d,
    ])
    const form = buildUploadForm(mp4Header, {
      filename: 'clip.mp4',
      contentType: 'video/mp4',
    })

    // Act
    const response = await app.inject({
      method: 'POST',
      url: `/files/upload?noteId=${note.data.id}`,
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${accessToken}`,
      },
      payload: form,
    })

    // Assert
    assert.equal(response.statusCode, 201)
    const uploaded = response.json().files[0]
    const serverPath = registerAttachmentCleanup(t, {
      ...uploaded,
      uploadDir: app.notesFileManager.uploadDir,
    })
    assert.equal(await fileExists(serverPath), true)
    assert.equal(uploaded.mimeType, 'video/mp4')
  })

  test('returns 201 for magic-byte verified WAV audio uploads', async (t) => {
    // Arrange
    const { app, accessToken, note } = await createNote(t)
    const wavForm = buildUploadForm(buildWavBuffer(20), {
      filename: 'meeting-note.wav',
      contentType: 'audio/wav',
    })

    // Act
    const wavResponse = await app.inject({
      method: 'POST',
      url: `/files/upload?noteId=${note.data.id}`,
      headers: {
        ...wavForm.getHeaders(),
        Authorization: `Bearer ${accessToken}`,
      },
      payload: wavForm,
    })

    // Assert
    assert.equal(wavResponse.statusCode, 201)
    const wavFile = wavResponse.json().files[0]
    const wavPath = registerAttachmentCleanup(t, {
      ...wavFile,
      uploadDir: app.notesFileManager.uploadDir,
    })
    assert.equal(await fileExists(wavPath), true)
    assert.equal(wavFile.mimeType, 'audio/wav')
    assert.equal(wavFile.size, 64)
  })

  test('returns 201 for magic-byte verified PNG image uploads', async (t) => {
    // Arrange
    const { app, accessToken, note } = await createNote(t)
    const pngForm = buildUploadForm(PNG_SAMPLE, {
      filename: 'pixel.png',
      contentType: 'image/png',
    })

    // Act
    const pngResponse = await app.inject({
      method: 'POST',
      url: `/files/upload?noteId=${note.data.id}`,
      headers: {
        ...pngForm.getHeaders(),
        Authorization: `Bearer ${accessToken}`,
      },
      payload: pngForm,
    })

    // Assert
    assert.equal(pngResponse.statusCode, 201)
    const pngFile = pngResponse.json().files[0]
    const pngPath = registerAttachmentCleanup(t, {
      ...pngFile,
      uploadDir: app.notesFileManager.uploadDir,
    })
    assert.equal(await fileExists(pngPath), true)
    assert.equal(pngFile.mimeType, 'image/png')
  })

  test('returns 400 when uploaded file exceeds MAX_UPLOAD_BYTES limit', async (t) => {
    // Arrange
    const { app, accessToken, note } = await createNote(t, {}, { env: { MAX_UPLOAD_BYTES: 128 } })
    const form = buildUploadForm(Buffer.alloc(256, 'x'), {
      filename: 'oversized.txt',
      contentType: 'text/plain',
    })

    // Act
    const response = await app.inject({
      method: 'POST',
      url: `/files/upload?noteId=${note.data.id}`,
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${accessToken}`,
      },
      payload: form,
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 400 when multipart upload contains no file parts', async (t) => {
    // Arrange
    const { app, accessToken, note } = await createNote(t)
    const form = new FormData()
    form.append('note', 'metadata-only')

    // Act
    const response = await app.inject({
      method: 'POST',
      url: `/files/upload?noteId=${note.data.id}`,
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${accessToken}`,
      },
      payload: form,
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 401 when unauthenticated', async (t) => {
    // Arrange
    const { app, note } = await createNote(t)
    const form = buildUploadForm('unauthorized-upload', {
      filename: 'unauthorized.txt',
      contentType: 'text/plain',
    })

    // Act
    const response = await app.inject({
      method: 'POST',
      url: `/files/upload?noteId=${note.data.id}`,
      headers: form.getHeaders(),
      payload: form,
    })

    // Assert
    assert.equal(response.statusCode, 401)
  })

  test('returns 404 when uploading to another users Note', async (t) => {
    // Arrange
    const owner = await createNote(t)
    const intruder = await seedUser(t, { app: owner.app })
    const form = buildUploadForm('cross-user-upload', {
      filename: 'cross-user.txt',
      contentType: 'text/plain',
    })

    // Act
    const response = await intruder.app.inject({
      method: 'POST',
      url: `/files/upload?noteId=${owner.note.data.id}`,
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${intruder.accessToken}`,
      },
      payload: form,
    })

    // Assert
    assert.equal(response.statusCode, 404)
  })

  test('returns 404 when target Note does not exist', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const form = buildUploadForm('missing-note-upload', {
      filename: 'missing.txt',
      contentType: 'text/plain',
    })

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: `/files/upload?noteId=${randomUUIDv7()}`,
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${actor.accessToken}`,
      },
      payload: form,
    })

    // Assert
    assert.equal(response.statusCode, 404)
  })

  test('returns 413 when upload exceeds USER_STORAGE_QUOTA_BYTES without adding attachment', async (t) => {
    // Arrange
    const { app, accessToken, userId, note } = await createNote(
      t,
      {},
      { env: { USER_STORAGE_QUOTA_BYTES: 100 } },
    )
    await app.notesDataSource.addAttachments(
      note.data.id,
      [
        {
          fileId: randomUUIDv7(),
          originalFilename: 'part1.txt',
          mimeType: 'text/plain',
          size: 60,
          uploadedAt: new Date().toISOString(),
        },
      ],
      userId,
    )

    const secondForm = buildUploadForm(Buffer.alloc(50, 'b'), {
      filename: 'over-quota.txt',
      contentType: 'text/plain',
    })

    // Act
    const response = await app.inject({
      method: 'POST',
      url: `/files/upload?noteId=${note.data.id}`,
      headers: {
        ...secondForm.getHeaders(),
        Authorization: `Bearer ${accessToken}`,
      },
      payload: secondForm,
    })

    // Assert
    assert.equal(response.statusCode, 413)
    const persisted = await app.notesDataSource.readNote(note.data.id, userId)
    assert.equal(persisted.attachments.length, 1)
  })

  test('returns 400 when Note already has maximum 10 attachments without breaking GET /notes/:id serialization', async (t) => {
    // Arrange
    const { app, accessToken, userId, note } = await createNote(t)
    const maxAttachments = Array.from({ length: 10 }, (_, idx) => ({
      fileId: randomUUIDv7(),
      originalFilename: `doc-${idx + 1}.txt`,
      mimeType: 'text/plain',
      size: 16,
      uploadedAt: new Date().toISOString(),
    }))
    await app.notesDataSource.addAttachments(note.data.id, maxAttachments, userId)

    const eleventhForm = buildUploadForm('eleventh attachment', {
      filename: 'eleventh.txt',
      contentType: 'text/plain',
    })

    // Act
    const response = await app.inject({
      method: 'POST',
      url: `/files/upload?noteId=${note.data.id}`,
      headers: {
        ...eleventhForm.getHeaders(),
        Authorization: `Bearer ${accessToken}`,
      },
      payload: eleventhForm,
    })

    // Assert
    assert.equal(response.statusCode, 400)
    const readRes = await app.inject({
      method: 'GET',
      url: `/notes/${note.data.id}`,
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    assert.equal(readRes.statusCode, 200)
    assert.equal(readRes.json().data.attachments.length, 10)
  })

  test('enforces 10-attachment ceiling atomically under concurrent uploads and cleans up losing disk file', async (t) => {
    // Arrange
    const { app, accessToken, userId, note } = await createNote(t)
    const initialNine = Array.from({ length: 9 }, (_, idx) => ({
      fileId: randomUUIDv7(),
      originalFilename: `doc-${idx + 1}.txt`,
      mimeType: 'text/plain',
      size: 16,
      uploadedAt: new Date().toISOString(),
    }))
    await app.notesDataSource.addAttachments(note.data.id, initialNine, userId)

    const dirEntriesBefore = new Set(
      await fs.readdir(app.notesFileManager.uploadDir).catch(() => []),
    )

    const formA = buildUploadForm('concurrent-upload-a', {
      filename: 'concurrent-a.txt',
      contentType: 'text/plain',
    })
    const formB = buildUploadForm('concurrent-upload-b', {
      filename: 'concurrent-b.txt',
      contentType: 'text/plain',
    })

    // Act
    const [resA, resB] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/files/upload?noteId=${note.data.id}`,
        headers: {
          ...formA.getHeaders(),
          Authorization: `Bearer ${accessToken}`,
        },
        payload: formA,
      }),
      app.inject({
        method: 'POST',
        url: `/files/upload?noteId=${note.data.id}`,
        headers: {
          ...formB.getHeaders(),
          Authorization: `Bearer ${accessToken}`,
        },
        payload: formB,
      }),
    ])

    const winner = resA.statusCode === 201 ? resA : resB
    const loser = resA.statusCode === 201 ? resB : resA
    if (winner.statusCode === 201) {
      const uploadedFile = winner.json().files[0]
      registerAttachmentCleanup(t, {
        ...uploadedFile,
        uploadDir: app.notesFileManager.uploadDir,
      })
    }

    // Assert
    assert.equal(winner.statusCode, 201)
    assert.equal(loser.statusCode, 400)

    const readRes = await app.inject({
      method: 'GET',
      url: `/notes/${note.data.id}`,
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    assert.equal(readRes.statusCode, 200)
    assert.equal(readRes.json().data.attachments.length, 10)

    const dirEntriesAfter = await fs.readdir(app.notesFileManager.uploadDir).catch(() => [])
    const newFilesOnDisk = dirEntriesAfter.filter((name) => !dirEntriesBefore.has(name))
    assert.equal(newFilesOnDisk.length, 1)
  })

  test('returns 415 on disallowed script extension', async (t) => {
    // Arrange
    const { app, accessToken, note } = await createNote(t)
    const form = buildUploadForm('console.log("hello")', {
      filename: 'script.js',
      contentType: 'application/javascript',
    })

    // Act
    const response = await app.inject({
      method: 'POST',
      url: `/files/upload?noteId=${note.data.id}`,
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${accessToken}`,
      },
      payload: form,
    })

    // Assert
    assert.equal(response.statusCode, 415)
  })

  test('returns 415 when random binary bytes are uploaded as PNG', async (t) => {
    // Arrange
    const { app, accessToken, note } = await createNote(t)
    const form = buildUploadForm(Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]), {
      filename: 'spoofed.png',
      contentType: 'image/png',
    })

    // Act
    const response = await app.inject({
      method: 'POST',
      url: `/files/upload?noteId=${note.data.id}`,
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${accessToken}`,
      },
      payload: form,
    })

    // Assert
    assert.equal(response.statusCode, 415)
  })

  test('returns 415 when PNG bytes are declared as text/plain', async (t) => {
    // Arrange
    const { app, accessToken, note } = await createNote(t)
    const form = buildUploadForm(PNG_SAMPLE, {
      filename: 'looks-like-text.txt',
      contentType: 'text/plain',
    })

    // Act
    const response = await app.inject({
      method: 'POST',
      url: `/files/upload?noteId=${note.data.id}`,
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${accessToken}`,
      },
      payload: form,
    })

    // Assert
    assert.equal(response.statusCode, 415)
  })

  test('returns 415 when binary bytes are uploaded as text/plain', async (t) => {
    // Arrange
    const { app, accessToken, note } = await createNote(t)
    const form = buildUploadForm(Buffer.from([0xff, 0xfe, 0x00, 0x01]), {
      filename: 'binary.txt',
      contentType: 'text/plain',
    })

    // Act
    const response = await app.inject({
      method: 'POST',
      url: `/files/upload?noteId=${note.data.id}`,
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${accessToken}`,
      },
      payload: form,
    })

    // Assert
    assert.equal(response.statusCode, 415)
  })

  test('returns 415 when legacy XLS uploads are attempted', async (t) => {
    // Arrange
    const { app, accessToken, note } = await createNote(t)
    const form = buildUploadForm('legacy-spreadsheet', {
      filename: 'legacy.xls',
      contentType: 'application/vnd.ms-excel',
    })

    // Act
    const response = await app.inject({
      method: 'POST',
      url: `/files/upload?noteId=${note.data.id}`,
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${accessToken}`,
      },
      payload: form,
    })

    // Assert
    assert.equal(response.statusCode, 415)
  })

  test('cleans up staged files when multipart parts limit triggers FST_FILES_LIMIT (413)', async (t) => {
    const uploadDir = await fs.mkdtemp(
      require('node:path').join(require('node:os').tmpdir(), 'fastify-upload-'),
    )
    t.after(async () => {
      await fs.rm(uploadDir, { recursive: true, force: true })
    })

    const { app, accessToken, note } = await createNote(
      t,
      {},
      { env: { UPLOAD_DIR: uploadDir, MAX_UPLOAD_FILES: 1 } }, // force 1 max file limit
    )

    const form = new FormData()
    form.append('file1', PNG_SAMPLE, { filename: 'valid1.png', contentType: 'image/png' })
    form.append('file2', PNG_SAMPLE, { filename: 'valid2.png', contentType: 'image/png' })

    const response = await app.inject({
      method: 'POST',
      url: `/files/upload?noteId=${note.data.id}`,
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${accessToken}`,
      },
      payload: form,
    })

    assert.equal(response.statusCode, 413)

    const files = await fs.readdir(uploadDir)
    assert.equal(files.length, 0)
  })

  test('returns 415 and cleans up staged files when multipart part is missing filename attribute', async (t) => {
    const uploadDir = await fs.mkdtemp(
      require('node:path').join(require('node:os').tmpdir(), 'fastify-upload-'),
    )
    t.after(async () => {
      await fs.rm(uploadDir, { recursive: true, force: true })
    })

    const { app, accessToken, note } = await createNote(t, {}, { env: { UPLOAD_DIR: uploadDir } })

    const boundary = '--------------------------8d499294453d3222d9ae5f46'
    const payload = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="file1"`,
      `Content-Type: application/octet-stream`,
      '',
      PNG_SAMPLE.toString('binary'),
      `--${boundary}--`,
      '',
    ].join('\r\n')

    const response = await app.inject({
      method: 'POST',
      url: `/files/upload?noteId=${note.data.id}`,
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        Authorization: `Bearer ${accessToken}`,
      },
      payload: Buffer.from(payload, 'binary'),
    })

    assert.equal(response.statusCode, 415)

    const files = await fs.readdir(uploadDir)
    assert.equal(files.length, 0)
  })

  test('returns 415 and cleans up staged files when multipart part has empty filename attribute', async (t) => {
    const uploadDir = await fs.mkdtemp(
      require('node:path').join(require('node:os').tmpdir(), 'fastify-upload-'),
    )
    t.after(async () => {
      await fs.rm(uploadDir, { recursive: true, force: true })
    })

    const { app, accessToken, note } = await createNote(t, {}, { env: { UPLOAD_DIR: uploadDir } })

    const boundary = '--------------------------8d499294453d3222d9ae5f46'
    const payload = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="file1"; filename=""`,
      `Content-Type: image/png`,
      '',
      PNG_SAMPLE.toString('binary'),
      `--${boundary}--`,
      '',
    ].join('\r\n')

    const response = await app.inject({
      method: 'POST',
      url: `/files/upload?noteId=${note.data.id}`,
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        Authorization: `Bearer ${accessToken}`,
      },
      payload: Buffer.from(payload, 'binary'),
    })

    assert.equal(response.statusCode, 415)

    const files = await fs.readdir(uploadDir)
    assert.equal(files.length, 0)
  })
})
