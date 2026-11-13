'use strict'

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs/promises')
const path = require('node:path')
const FormData = require('form-data')
const { MongoClient } = require('mongodb')
const { createNote } = require('../../../../utils/note-creator')
const { setup } = require('../../../../utils/setup-user')
const { buildMarkdownNote } = require('../../../../utils/markdown-note')
const { getGzipResponse, listenOnRandomPort } = require('../../../../utils/http-compression')

const ROUTE_PREFIX = '/files'
const PNG_SAMPLE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aMcAAAAASUVORK5CYII=',
  'base64',
)

function toCsvCell(value) {
  const stringValue = String(value)

  if (!/[",\n]/.test(stringValue)) {
    return stringValue
  }

  return `"${stringValue.replace(/"/g, '""')}"`
}

function buildCsvRow(values) {
  return values.map((value) => toCsvCell(value)).join(',')
}

function buildImportCsv(rows, headers = ['title', 'body', 'tags']) {
  return [buildCsvRow(headers), ...rows.map((row) => buildCsvRow(row))].join('\n')
}

function uploadFilePath(fileId, originalFilename) {
  const extension = path.extname(originalFilename) || '.bin'
  return path.join(process.cwd(), 'uploads', `${fileId}${extension}`)
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

function registerFileCleanup(t, fileId, originalFilename) {
  const serverPath = uploadFilePath(fileId, originalFilename)
  t.after(async () => {
    await fs.unlink(serverPath).catch(() => {})
  })
  return serverPath
}

async function uploadNoteFile(app, accessToken, noteId, form) {
  return await app.inject({
    method: 'POST',
    url: `${ROUTE_PREFIX}/upload?noteId=${noteId}`,
    headers: {
      ...form.getHeaders(),
      Authorization: `Bearer ${accessToken}`,
    },
    payload: form,
  })
}

async function importNotesFile(app, accessToken, csvContent, filename = 'import.csv') {
  const form = new FormData()
  form.append('file', Buffer.from(csvContent), { filename, contentType: 'text/csv' })

  return await app.inject({
    method: 'POST',
    url: `${ROUTE_PREFIX}/import`,
    headers: {
      ...form.getHeaders(),
      Authorization: `Bearer ${accessToken}`,
    },
    payload: form,
  })
}

async function updateAttachmentOriginalFilename(mongoUrl, noteId, fileId, originalFilename) {
  const client = new MongoClient(mongoUrl)
  await client.connect()

  try {
    const db = client.db()
    await db
      .collection('notes')
      .updateOne(
        { id: noteId, 'attachments.fileId': fileId },
        { $set: { 'attachments.$.originalFilename': originalFilename } },
      )
  } finally {
    await client.close()
  }
}

test('POST /files/import 201 - Successfully parses and imports CSV', async (t) => {
  // Arrange
  const { app, accessToken } = await setup(t, 'user')
  const csvContent = buildImportCsv([
    ['Test Title 1', 'Test Body 1', JSON.stringify(['tagA'])],
    ['Test Title 2', 'Test Body 2', JSON.stringify(['tagB', 'tagC'])],
  ])

  // Act
  const response = await importNotesFile(app, accessToken, csvContent)

  // Assert
  assert.strictEqual(response.statusCode, 201)
  const insertedIds = response.json()
  assert.strictEqual(Array.isArray(insertedIds), true)
  assert.strictEqual(insertedIds.length, 2, 'Should have imported exactly 2 notes')
})

test('POST /files/import 201 - Accepts empty body cells and persists them as empty strings', async (t) => {
  // Arrange
  const { app, accessToken } = await setup(t, 'user')
  const csvContent = buildImportCsv([['Empty body note', '', JSON.stringify(['draft'])]])

  // Act
  const response = await importNotesFile(app, accessToken, csvContent, 'empty-body.csv')

  // Assert
  assert.strictEqual(response.statusCode, 201)

  const [insertedId] = response.json()
  const readResponse = await app.inject({
    method: 'GET',
    url: `/notes/${insertedId}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  assert.strictEqual(readResponse.statusCode, 200)
  assert.strictEqual(readResponse.json().data.body, '')
})

test('POST /files/import 201 - Imports large markdown bodies unchanged', async (t) => {
  // Arrange
  const { app, accessToken } = await setup(t, 'user')
  const markdownBody = buildMarkdownNote({ minLength: 32000 })
  const csvContent = buildImportCsv([
    ['Milkdown import note', markdownBody, JSON.stringify(['markdown', 'import'])],
  ])

  // Act
  const response = await importNotesFile(app, accessToken, csvContent, 'milkdown-import.csv')

  // Assert
  assert.strictEqual(response.statusCode, 201)

  const [insertedId] = response.json()
  const readResponse = await app.inject({
    method: 'GET',
    url: `/notes/${insertedId}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  assert.strictEqual(readResponse.statusCode, 200)
  assert.strictEqual(readResponse.json().data.body, markdownBody)
})

test('POST /files/import 201 - Round-trips exported CSV without metadata contaminating tags', async (t) => {
  // Arrange
  const originalTags = ['ops', 'q2']
  const { app, accessToken, note } = await createNote(t, { tags: originalTags })

  const exportResponse = await app.inject({
    method: 'GET',
    url: `${ROUTE_PREFIX}/export`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  assert.strictEqual(exportResponse.statusCode, 200)

  // Act
  const importResponse = await importNotesFile(
    app,
    accessToken,
    exportResponse.body,
    'round-trip.csv',
  )

  // Assert
  assert.strictEqual(importResponse.statusCode, 201)

  const insertedIds = importResponse.json()
  assert.strictEqual(insertedIds.length, 1)

  const readResponse = await app.inject({
    method: 'GET',
    url: `/notes/${insertedIds[0]}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  assert.strictEqual(readResponse.statusCode, 200)

  const importedNote = readResponse.json().data
  assert.deepStrictEqual(importedNote.tags, originalTags)
  assert.notStrictEqual(importedNote.id, note.data.id)
  assert.strictEqual(importedNote.tags.includes(note.data.id), false)
})

test('POST /files/import 201 - Round-trips exported CSV for empty-body notes', async (t) => {
  // Arrange
  const { app, accessToken } = await createNote(t, {
    title: 'Empty body round-trip',
    body: '',
    tags: ['round-trip'],
  })

  const exportResponse = await app.inject({
    method: 'GET',
    url: `${ROUTE_PREFIX}/export`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  assert.strictEqual(exportResponse.statusCode, 200)

  // Act
  const importResponse = await importNotesFile(
    app,
    accessToken,
    exportResponse.body,
    'empty-round-trip.csv',
  )

  // Assert
  assert.strictEqual(importResponse.statusCode, 201)

  const insertedIds = importResponse.json()
  assert.strictEqual(insertedIds.length, 1)

  const readResponse = await app.inject({
    method: 'GET',
    url: `/notes/${insertedIds[0]}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  assert.strictEqual(readResponse.statusCode, 200)
  assert.strictEqual(readResponse.json().data.body, '')
})

test('POST /files/import 201 - Ignores metadata columns when importing CSV', async (t) => {
  // Arrange
  const { app, accessToken } = await setup(t, 'user')
  const csvContent = buildImportCsv(
    [
      [
        'Meta Title',
        'Meta Body',
        JSON.stringify(['tagA', 'tagB']),
        '2000-01-01T00:00:00.000Z',
        '2000-01-02T00:00:00.000Z',
        'legacy-id',
      ],
    ],
    ['title', 'body', 'tags', 'createdAt', 'modifiedAt', 'id'],
  )

  // Act
  const response = await importNotesFile(app, accessToken, csvContent, 'metadata.csv')

  // Assert
  assert.strictEqual(response.statusCode, 201)

  const [insertedId] = response.json()
  const readResponse = await app.inject({
    method: 'GET',
    url: `/notes/${insertedId}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  assert.strictEqual(readResponse.statusCode, 200)

  const importedNote = readResponse.json().data
  assert.strictEqual(importedNote.id, insertedId)
  assert.notStrictEqual(importedNote.id, 'legacy-id')
  assert.deepStrictEqual(importedNote.tags, ['tagA', 'tagB'])
})

test('POST /files/import 400 - Rejects malformed tags cells', async (t) => {
  // Arrange
  const { app, accessToken } = await setup(t, 'user')
  const csvContent = buildImportCsv([['Broken Title', 'Broken Body', 'not-json']])

  // Act
  const response = await importNotesFile(app, accessToken, csvContent, 'malformed-tags.csv')

  // Assert
  assert.strictEqual(response.statusCode, 400)
  assert.match(response.json().message, /tags must be a JSON array of strings/)
})

test('POST /files/import 201 - Imports CSV across batch boundaries', async (t) => {
  // Arrange
  const { app, accessToken } = await setup(t, 'user')
  const rowCount = 501
  const rows = Array.from({ length: rowCount }, (_, index) => [
    `Title ${index}`,
    `Body ${index}`,
    JSON.stringify([`t${index % 10}`]),
  ])
  const csvContent = buildImportCsv(rows)

  // Act
  const response = await importNotesFile(app, accessToken, csvContent, 'batched-import.csv')

  // Assert
  assert.strictEqual(response.statusCode, 201)
  assert.strictEqual(response.json().length, rowCount)
})

test('GET /files/export 200 - Successfully exports notes as CSV stream', async (t) => {
  // Arrange
  const { app, accessToken, note } = await createNote(t)

  // Act
  const response = await app.inject({
    method: 'GET',
    url: `${ROUTE_PREFIX}/export`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  assert.strictEqual(response.statusCode, 200)
  assert.strictEqual(response.headers['content-type'], 'text/csv')
  assert.ok(
    response.headers['content-disposition'].includes('attachment; filename="note-list.csv"'),
  )

  const csvOutput = response.body
  assert.ok(
    csvOutput.includes(note.data.title),
    'Exported CSV should contain the created note title',
  )
})

test('GET /files/export 200 - Compresses large CSV exports over HTTP when gzip is requested', async (t) => {
  // Arrange
  const markdownBody = buildMarkdownNote({ minLength: 32000 })
  const { app, accessToken } = await createNote(t, {
    title: 'Compressed export note',
    body: markdownBody,
    tags: ['csv', 'gzip'],
  })
  const port = await listenOnRandomPort(app)

  // Act
  const response = await getGzipResponse({
    port,
    path: `${ROUTE_PREFIX}/export`,
    accessToken,
  })

  // Assert
  assert.strictEqual(response.statusCode, 200)
  assert.strictEqual(response.headers['content-encoding'], 'gzip')
  assert.match(response.headers['content-type'], /^text\/csv/)
  assert.ok(response.body.includes('Compressed export note'))
  assert.ok(response.rawBody.length < Buffer.byteLength(response.body))
})

test('GET /files/export 200 - Exports all notes beyond the default list limit', async (t) => {
  // Arrange
  const { app, accessToken } = await setup(t, 'user')
  const rowCount = 55
  const csvContent = buildImportCsv(
    Array.from({ length: rowCount }, (_, index) => [
      `Export Title ${index}`,
      `Export Body ${index}`,
      JSON.stringify([`tag${index}`]),
    ]),
  )

  const importResponse = await importNotesFile(app, accessToken, csvContent, 'export-limit.csv')
  assert.strictEqual(importResponse.statusCode, 201)

  // Act
  const response = await app.inject({
    method: 'GET',
    url: `${ROUTE_PREFIX}/export`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  assert.strictEqual(response.statusCode, 200)
  assert.strictEqual(response.body.trim().split('\n').length, rowCount + 1)
  assert.ok(response.body.includes('Export Title 54'))
})

test('GET /files/export 200 - Sanitizes spreadsheet formula prefixes in CSV output', async (t) => {
  // Arrange
  const formulaTitle = '=SUM(1,1)'
  const { app, accessToken } = await createNote(t, { title: formulaTitle })

  // Act
  const response = await app.inject({
    method: 'GET',
    url: `${ROUTE_PREFIX}/export`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  assert.strictEqual(response.statusCode, 200)
  assert.ok(response.body.includes(`"'${formulaTitle}"`))
  assert.strictEqual(response.body.includes(`"${formulaTitle}"`), false)
})

test('POST /files/upload 201 - Successfully saves raw file to disk', async (t) => {
  // Arrange
  const { app, accessToken, note } = await createNote(t)
  const fileName = 'test-upload-file.txt'
  const fileContent = 'Hello, this is a raw file upload test!'

  const form = new FormData()
  form.append('file', Buffer.from(fileContent), { filename: fileName, contentType: 'text/plain' })

  // Act
  const response = await uploadNoteFile(app, accessToken, note.data.id, form)
  const body = response.json()
  const uploadedFile = body.files[0]
  const serverPath = registerFileCleanup(t, uploadedFile.fileId, uploadedFile.originalFilename)
  const uploadedFileExists = await fileExists(serverPath)

  // Assert
  assert.strictEqual(response.statusCode, 201)
  assert.strictEqual(body.message, 'Files uploaded successfully')
  assert.strictEqual(body.files.length, 1)
  assert.ok(uploadedFile.fileId)
  assert.strictEqual(uploadedFile.originalFilename, fileName)
  assert.strictEqual(uploadedFile.mimeType, 'text/plain')
  assert.strictEqual(uploadedFileExists, true, 'File should exist in the uploads directory')
})

test('POST /files/upload 201 - Invalidates cached note reads after attachment upload', async (t) => {
  // Arrange
  const { app, accessToken, note } = await createNote(t)
  const fileName = 'attachment-cache.txt'
  const form = new FormData()
  form.append('file', Buffer.from('attachment-cache-test'), {
    filename: fileName,
    contentType: 'text/plain',
  })

  const cachedReadResponse = await app.inject({
    method: 'GET',
    url: `/notes/${note.data.id}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  assert.strictEqual(cachedReadResponse.statusCode, 200)
  assert.deepStrictEqual(cachedReadResponse.json().data.attachments, [])

  // Act
  const uploadResponse = await uploadNoteFile(app, accessToken, note.data.id, form)
  const uploadedFile = uploadResponse.json().files[0]
  registerFileCleanup(t, uploadedFile.fileId, uploadedFile.originalFilename)

  const refreshedReadResponse = await app.inject({
    method: 'GET',
    url: `/notes/${note.data.id}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  assert.strictEqual(uploadResponse.statusCode, 201)
  assert.strictEqual(refreshedReadResponse.statusCode, 200)
  assert.strictEqual(refreshedReadResponse.json().data.attachments.length, 1)
  assert.strictEqual(refreshedReadResponse.json().data.attachments[0].originalFilename, fileName)
})

test('POST /files/upload 201 - Accepts valid CSV content', async (t) => {
  // Arrange
  const { app, accessToken, note } = await createNote(t)
  const fileName = 'note-import.csv'
  const form = new FormData()
  form.append('file', Buffer.from('title,body\nAlpha,Beta\n'), {
    filename: fileName,
    contentType: 'text/csv',
  })

  // Act
  const response = await uploadNoteFile(app, accessToken, note.data.id, form)
  const body = response.json()
  const uploadedFile = body.files[0]
  const serverPath = registerFileCleanup(t, uploadedFile.fileId, uploadedFile.originalFilename)

  // Assert
  assert.strictEqual(response.statusCode, 201)
  assert.strictEqual(await fileExists(serverPath), true)
  assert.strictEqual(uploadedFile.mimeType, 'text/csv')
})

test('POST /files/import 400 - Fails if no file is provided', async (t) => {
  // Arrange
  const { app, accessToken } = await setup(t, 'user')
  const form = new FormData()

  // Act
  const response = await app.inject({
    method: 'POST',
    url: `${ROUTE_PREFIX}/import`,
    headers: {
      ...form.getHeaders(),
      Authorization: `Bearer ${accessToken}`,
    },
    payload: form,
  })

  // Assert
  assert.strictEqual(response.statusCode, 400)
})

test('POST /files/import 401 - Requires authentication', async (t) => {
  // Arrange
  const { app } = await setup(t, 'user')
  const csvContent = buildImportCsv([['Phase 1', 'Security', JSON.stringify(['auth'])]])
  const form = new FormData()
  form.append('file', Buffer.from(csvContent), 'import.csv')

  // Act
  const response = await app.inject({
    method: 'POST',
    url: `${ROUTE_PREFIX}/import`,
    headers: form.getHeaders(),
    payload: form,
  })

  // Assert
  assert.strictEqual(response.statusCode, 401)
})

test('POST /files/upload 415 - Fails on unallowed extensions', async (t) => {
  // Arrange
  const { app, accessToken, note } = await createNote(t)
  const form = new FormData()
  form.append('file', Buffer.from('console.log("hello")'), {
    filename: 'script.js',
    contentType: 'application/javascript',
  })

  // Act
  const response = await app.inject({
    method: 'POST',
    url: `${ROUTE_PREFIX}/upload?noteId=${note.data.id}`,
    headers: { ...form.getHeaders(), Authorization: `Bearer ${accessToken}` },
    payload: form,
  })

  // Assert
  assert.strictEqual(response.statusCode, 415)
})

test('POST /files/upload 415 - Rejects random binary bytes uploaded as PNG', async (t) => {
  // Arrange
  const { app, accessToken, note } = await createNote(t)
  const form = new FormData()
  form.append('file', Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]), {
    filename: 'spoofed.png',
    contentType: 'image/png',
  })

  // Act
  const response = await uploadNoteFile(app, accessToken, note.data.id, form)

  // Assert
  assert.strictEqual(response.statusCode, 415)
})

test('POST /files/upload 415 - Rejects PNG bytes labeled as text/plain', async (t) => {
  // Arrange
  const { app, accessToken, note } = await createNote(t)
  const form = new FormData()
  form.append('file', PNG_SAMPLE, {
    filename: 'looks-like-text.txt',
    contentType: 'text/plain',
  })

  // Act
  const response = await uploadNoteFile(app, accessToken, note.data.id, form)

  // Assert
  assert.strictEqual(response.statusCode, 415)
})

test('POST /files/upload 415 - Rejects binary payload uploaded as text', async (t) => {
  // Arrange
  const { app, accessToken, note } = await createNote(t)
  const form = new FormData()
  form.append('file', Buffer.from([0xff, 0xfe, 0x00, 0x01]), {
    filename: 'binary.txt',
    contentType: 'text/plain',
  })

  // Act
  const response = await uploadNoteFile(app, accessToken, note.data.id, form)

  // Assert
  assert.strictEqual(response.statusCode, 415)
})

test('POST /files/upload 415 - Rejects XLS uploads by policy', async (t) => {
  // Arrange
  const { app, accessToken, note } = await createNote(t)
  const form = new FormData()
  form.append('file', Buffer.from('legacy-spreadsheet'), {
    filename: 'legacy.xls',
    contentType: 'application/vnd.ms-excel',
  })

  // Act
  const response = await uploadNoteFile(app, accessToken, note.data.id, form)

  // Assert
  assert.strictEqual(response.statusCode, 415)
})

test('GET /files/export 401 - Requires authentication', async (t) => {
  // Arrange
  const { app } = await setup(t, 'user')

  // Act
  const response = await app.inject({
    method: 'GET',
    url: `${ROUTE_PREFIX}/export`,
  })

  // Assert
  assert.strictEqual(response.statusCode, 401)
})

test('POST /files/upload 401 - Requires authentication', async (t) => {
  // Arrange
  const { app, note } = await createNote(t)
  const form = new FormData()
  form.append('file', Buffer.from('unauthorized-upload'), {
    filename: 'unauthorized.txt',
    contentType: 'text/plain',
  })

  // Act
  const response = await app.inject({
    method: 'POST',
    url: `${ROUTE_PREFIX}/upload?noteId=${note.data.id}`,
    headers: form.getHeaders(),
    payload: form,
  })

  // Assert
  assert.strictEqual(response.statusCode, 401)
})

test('GET /files/:fileId 200 - Successfully streams binary content', async (t) => {
  // Arrange
  const { app, accessToken, note } = await createNote(t)
  const form = new FormData()
  const fileName = 'download.txt'
  form.append('file', Buffer.from('download-me'), { filename: fileName, contentType: 'text/plain' })

  const uploadRes = await uploadNoteFile(app, accessToken, note.data.id, form)
  assert.strictEqual(uploadRes.statusCode, 201)
  const fileId = uploadRes.json().files[0].fileId
  registerFileCleanup(t, fileId, fileName)

  // Act
  const downloadRes = await app.inject({
    method: 'GET',
    url: `${ROUTE_PREFIX}/${fileId}?noteId=${note.data.id}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  assert.strictEqual(downloadRes.statusCode, 200)
  assert.strictEqual(downloadRes.body, 'download-me')
})

test('GET /files/:fileId 401 - Requires authentication', async (t) => {
  // Arrange
  const { app, accessToken, note } = await createNote(t)
  const form = new FormData()
  const fileName = 'private-download.txt'
  form.append('file', Buffer.from('private-download'), {
    filename: fileName,
    contentType: 'text/plain',
  })

  const uploadRes = await uploadNoteFile(app, accessToken, note.data.id, form)
  assert.strictEqual(uploadRes.statusCode, 201)
  const fileId = uploadRes.json().files[0].fileId
  registerFileCleanup(t, fileId, fileName)

  // Act
  const response = await app.inject({
    method: 'GET',
    url: `${ROUTE_PREFIX}/${fileId}?noteId=${note.data.id}`,
  })

  // Assert
  assert.strictEqual(response.statusCode, 401)
})

test('POST /files/upload 400 - Fails when file exceeds 10MB size limit', async (t) => {
  // Arrange
  const { app, accessToken, note } = await createNote(t)
  const form = new FormData()
  // 10MB + 1 byte to exceed the multipart fileSize limit
  form.append('file', Buffer.alloc(10_000_001), {
    filename: 'oversized.txt',
    contentType: 'text/plain',
  })

  // Act
  const response = await app.inject({
    method: 'POST',
    url: `${ROUTE_PREFIX}/upload?noteId=${note.data.id}`,
    headers: { ...form.getHeaders(), Authorization: `Bearer ${accessToken}` },
    payload: form,
  })

  // Assert
  assert.strictEqual(response.statusCode, 400)
})

test('GET /files/:fileId 404 - Fails when fileId is not attached to the note', async (t) => {
  // Arrange
  const { app, accessToken, note } = await createNote(t)
  const nonExistentFileId = '00000000-0000-4000-a000-000000000000'

  // Act
  const response = await app.inject({
    method: 'GET',
    url: `${ROUTE_PREFIX}/${nonExistentFileId}?noteId=${note.data.id}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  assert.strictEqual(response.statusCode, 404)
})

test('POST /files/upload 404 - Different user cannot upload to another users note', async (t) => {
  // Arrange
  const owner = await createNote(t)
  const intruder = await setup(t, 'user')
  const form = new FormData()
  form.append('file', Buffer.from('cross-user-upload'), {
    filename: 'cross-user.txt',
    contentType: 'text/plain',
  })

  // Act
  const response = await uploadNoteFile(
    intruder.app,
    intruder.accessToken,
    owner.note.data.id,
    form,
  )

  // Assert
  assert.strictEqual(response.statusCode, 404)
})

test('GET /files/:fileId 404 - Different user cannot download another users file', async (t) => {
  // Arrange
  const owner = await createNote(t)
  const intruder = await setup(t, 'user')
  const form = new FormData()
  const fileName = 'owners-secret.txt'
  form.append('file', Buffer.from('owner-secret'), {
    filename: fileName,
    contentType: 'text/plain',
  })

  const uploadRes = await uploadNoteFile(owner.app, owner.accessToken, owner.note.data.id, form)
  assert.strictEqual(uploadRes.statusCode, 201)

  const fileId = uploadRes.json().files[0].fileId
  registerFileCleanup(t, fileId, fileName)

  // Act
  const response = await intruder.app.inject({
    method: 'GET',
    url: `${ROUTE_PREFIX}/${fileId}?noteId=${owner.note.data.id}`,
    headers: { Authorization: `Bearer ${intruder.accessToken}` },
  })

  // Assert
  assert.strictEqual(response.statusCode, 404)
})

test('GET /files/:fileId 200 - Returns ETag and Last-Modified caching headers', async (t) => {
  // Arrange
  const { app, accessToken, note } = await createNote(t)
  const form = new FormData()
  const fileName = 'etag-file.txt'
  form.append('file', Buffer.from('etag-content'), {
    filename: fileName,
    contentType: 'text/plain',
  })
  const uploadRes = await uploadNoteFile(app, accessToken, note.data.id, form)
  assert.strictEqual(uploadRes.statusCode, 201)
  const fileId = uploadRes.json().files[0].fileId
  registerFileCleanup(t, fileId, fileName)

  // Act
  const response = await app.inject({
    method: 'GET',
    url: `${ROUTE_PREFIX}/${fileId}?noteId=${note.data.id}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  assert.strictEqual(response.statusCode, 200)
  assert.ok(response.headers['etag'], 'ETag header should be present')
  assert.match(response.headers['etag'], /^W\/"/, 'ETag should be a weak ETag')
  assert.ok(response.headers['last-modified'], 'Last-Modified header should be present')
  assert.strictEqual(response.headers['cache-control'], 'private, no-cache')
  assert.ok(
    !Number.isNaN(Date.parse(response.headers['last-modified'])),
    'Last-Modified should be a valid HTTP date',
  )
})

test('GET /files/:fileId 304 - Returns 304 on matching If-None-Match', async (t) => {
  // Arrange
  const { app, accessToken, note } = await createNote(t)
  const form = new FormData()
  const fileName = 'conditional-etag.txt'
  form.append('file', Buffer.from('conditional-content'), {
    filename: fileName,
    contentType: 'text/plain',
  })
  const uploadRes = await uploadNoteFile(app, accessToken, note.data.id, form)
  assert.strictEqual(uploadRes.statusCode, 201)
  const fileId = uploadRes.json().files[0].fileId
  registerFileCleanup(t, fileId, fileName)

  const firstResponse = await app.inject({
    method: 'GET',
    url: `${ROUTE_PREFIX}/${fileId}?noteId=${note.data.id}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  assert.strictEqual(firstResponse.statusCode, 200)
  const etag = firstResponse.headers['etag']
  const lastModified = firstResponse.headers['last-modified']

  // Act
  const conditionalResponse = await app.inject({
    method: 'GET',
    url: `${ROUTE_PREFIX}/${fileId}?noteId=${note.data.id}`,
    headers: { Authorization: `Bearer ${accessToken}`, 'if-none-match': etag },
  })

  // Assert
  assert.strictEqual(conditionalResponse.statusCode, 304)
  assert.strictEqual(conditionalResponse.headers['etag'], etag)
  assert.strictEqual(conditionalResponse.headers['last-modified'], lastModified)
  assert.strictEqual(conditionalResponse.headers['cache-control'], 'private, no-cache')
  assert.strictEqual(conditionalResponse.body, '')
})

test('GET /files/:fileId 304 - Returns 304 on matching If-Modified-Since', async (t) => {
  // Arrange
  const { app, accessToken, note } = await createNote(t)
  const form = new FormData()
  const fileName = 'conditional-ims.txt'
  form.append('file', Buffer.from('ims-content'), {
    filename: fileName,
    contentType: 'text/plain',
  })
  const uploadRes = await uploadNoteFile(app, accessToken, note.data.id, form)
  assert.strictEqual(uploadRes.statusCode, 201)
  const fileId = uploadRes.json().files[0].fileId
  registerFileCleanup(t, fileId, fileName)

  const firstResponse = await app.inject({
    method: 'GET',
    url: `${ROUTE_PREFIX}/${fileId}?noteId=${note.data.id}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  assert.strictEqual(firstResponse.statusCode, 200)
  const lastModified = firstResponse.headers['last-modified']

  // Act
  const conditionalResponse = await app.inject({
    method: 'GET',
    url: `${ROUTE_PREFIX}/${fileId}?noteId=${note.data.id}`,
    headers: { Authorization: `Bearer ${accessToken}`, 'if-modified-since': lastModified },
  })

  // Assert
  assert.strictEqual(conditionalResponse.statusCode, 304)
  assert.strictEqual(conditionalResponse.headers['last-modified'], lastModified)
  assert.strictEqual(conditionalResponse.headers['cache-control'], 'private, no-cache')
  assert.strictEqual(conditionalResponse.body, '')
})

test('GET /files/:fileId 200 - Prefers If-None-Match over If-Modified-Since', async (t) => {
  // Arrange
  const { app, accessToken, note } = await createNote(t)
  const form = new FormData()
  const fileName = 'conditional-precedence.txt'
  const fileContent = 'precedence-content'
  form.append('file', Buffer.from(fileContent), {
    filename: fileName,
    contentType: 'text/plain',
  })
  const uploadRes = await uploadNoteFile(app, accessToken, note.data.id, form)
  assert.strictEqual(uploadRes.statusCode, 201)
  const fileId = uploadRes.json().files[0].fileId
  registerFileCleanup(t, fileId, fileName)

  const firstResponse = await app.inject({
    method: 'GET',
    url: `${ROUTE_PREFIX}/${fileId}?noteId=${note.data.id}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  assert.strictEqual(firstResponse.statusCode, 200)
  const lastModified = firstResponse.headers['last-modified']

  // Act
  const conditionalResponse = await app.inject({
    method: 'GET',
    url: `${ROUTE_PREFIX}/${fileId}?noteId=${note.data.id}`,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'if-none-match': 'W/"not-the-current-etag"',
      'if-modified-since': lastModified,
    },
  })

  // Assert
  assert.strictEqual(conditionalResponse.statusCode, 200)
  assert.strictEqual(conditionalResponse.body, fileContent)
})

test('GET /files/:fileId 200 - Sanitizes unsafe characters from Content-Disposition filename', async (t) => {
  // Arrange
  const { app, accessToken, note, mongoUrl } = await createNote(t)
  const form = new FormData()
  const uploadedFileName = 'sanitize-source.txt'
  const unsafeFileName = 'folder\\report"2026\r\nevil.txt'
  form.append('file', Buffer.from('sanitized-name-test'), {
    filename: uploadedFileName,
    contentType: 'text/plain',
  })
  const uploadRes = await uploadNoteFile(app, accessToken, note.data.id, form)
  assert.strictEqual(uploadRes.statusCode, 201)
  const fileId = uploadRes.json().files[0].fileId
  registerFileCleanup(t, fileId, uploadedFileName)
  await updateAttachmentOriginalFilename(mongoUrl, note.data.id, fileId, unsafeFileName)

  // Act
  const response = await app.inject({
    method: 'GET',
    url: `${ROUTE_PREFIX}/${fileId}?noteId=${note.data.id}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  assert.strictEqual(response.statusCode, 200)
  const disposition = response.headers['content-disposition']
  const filename = disposition.match(/^attachment; filename="(.+)"$/)?.[1]
  assert.ok(filename, 'Sanitized filename should be present')
  assert.ok(!filename.includes('"'), 'Double-quote should be replaced in filename')
  assert.ok(!filename.includes('\\'), 'Backslash should be replaced in filename')
  assert.ok(!filename.includes('\r'), 'CR should be replaced in filename')
  assert.ok(!filename.includes('\n'), 'LF should be replaced in filename')
})

test('GET /files/:fileId 200 - Falls back for unsafe-only Content-Disposition filename', async (t) => {
  // Arrange
  const { app, accessToken, note, mongoUrl } = await createNote(t)
  const form = new FormData()
  const uploadedFileName = 'blank-fallback-source.txt'
  form.append('file', Buffer.from('fallback-name-test'), {
    filename: uploadedFileName,
    contentType: 'text/plain',
  })
  const uploadRes = await uploadNoteFile(app, accessToken, note.data.id, form)
  assert.strictEqual(uploadRes.statusCode, 201)
  const fileId = uploadRes.json().files[0].fileId
  const sourcePath = registerFileCleanup(t, fileId, uploadedFileName)
  const extensionlessPath = path.join(process.cwd(), 'uploads', fileId)
  await fs.copyFile(sourcePath, extensionlessPath)
  t.after(async () => {
    await fs.unlink(extensionlessPath).catch(() => {})
  })
  await updateAttachmentOriginalFilename(mongoUrl, note.data.id, fileId, '\\\r\n"   ')

  // Act
  const response = await app.inject({
    method: 'GET',
    url: `${ROUTE_PREFIX}/${fileId}?noteId=${note.data.id}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  assert.strictEqual(response.statusCode, 200)
  assert.strictEqual(response.headers['content-disposition'], 'attachment; filename="attachment"')
})

test('GET /files/:fileId 206 & 416 - Supports HTTP Range byte-slice streaming and rejects invalid ranges', async (t) => {
  const { app, accessToken, note } = await createNote(t)
  const form = new FormData()
  const fileName = 'range-test.txt'
  const content = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  form.append('file', Buffer.from(content), {
    filename: fileName,
    contentType: 'text/plain',
  })

  const uploadRes = await uploadNoteFile(app, accessToken, note.data.id, form)
  assert.strictEqual(uploadRes.statusCode, 201)
  const fileId = uploadRes.json().files[0].fileId
  registerFileCleanup(t, fileId, fileName)

  // Full 200 download advertises Accept-Ranges and Content-Length
  const fullRes = await app.inject({
    method: 'GET',
    url: `${ROUTE_PREFIX}/${fileId}?noteId=${note.data.id}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  assert.strictEqual(fullRes.statusCode, 200)
  assert.strictEqual(fullRes.headers['accept-ranges'], 'bytes')
  assert.strictEqual(Number(fullRes.headers['content-length']), content.length)

  // Partial 206 download (bytes=10-15 -> 'ABCDEF')
  const rangeRes = await app.inject({
    method: 'GET',
    url: `${ROUTE_PREFIX}/${fileId}?noteId=${note.data.id}`,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Range: 'bytes=10-15',
    },
  })
  assert.strictEqual(rangeRes.statusCode, 206)
  assert.strictEqual(rangeRes.headers['accept-ranges'], 'bytes')
  assert.strictEqual(rangeRes.headers['content-range'], `bytes 10-15/${content.length}`)
  assert.strictEqual(Number(rangeRes.headers['content-length']), 6)
  assert.strictEqual(rangeRes.body, 'ABCDEF')

  // Open-ended range (bytes=30- -> 'UVWXYZ')
  const openEndedRes = await app.inject({
    method: 'GET',
    url: `${ROUTE_PREFIX}/${fileId}?noteId=${note.data.id}`,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Range: 'bytes=30-',
    },
  })
  assert.strictEqual(openEndedRes.statusCode, 206)
  assert.strictEqual(
    openEndedRes.headers['content-range'],
    `bytes 30-${content.length - 1}/${content.length}`,
  )
  assert.strictEqual(openEndedRes.body, 'UVWXYZ')

  // Suffix range (bytes=-4 -> 'WXYZ')
  const suffixRes = await app.inject({
    method: 'GET',
    url: `${ROUTE_PREFIX}/${fileId}?noteId=${note.data.id}`,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Range: 'bytes=-4',
    },
  })
  assert.strictEqual(suffixRes.statusCode, 206)
  assert.strictEqual(
    suffixRes.headers['content-range'],
    `bytes ${content.length - 4}-${content.length - 1}/${content.length}`,
  )
  assert.strictEqual(suffixRes.body, 'WXYZ')

  // Out-of-bounds range returns 416 Range Not Satisfiable
  const invalidRangeRes = await app.inject({
    method: 'GET',
    url: `${ROUTE_PREFIX}/${fileId}?noteId=${note.data.id}`,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Range: 'bytes=500-600',
    },
  })
  assert.strictEqual(invalidRangeRes.statusCode, 416)
  assert.strictEqual(invalidRangeRes.headers['content-range'], `bytes */${content.length}`)
})

test('POST /files/upload 201 & GET 206 - Uploads magic-byte verified WAV audio and streams byte ranges', async (t) => {
  const { app, accessToken, note } = await createNote(t)
  const wavBuffer = Buffer.alloc(64)
  wavBuffer.write('RIFF', 0, 'ascii')
  wavBuffer.writeUInt32LE(56, 4)
  wavBuffer.write('WAVE', 8, 'ascii')
  wavBuffer.write('fmt ', 12, 'ascii')
  wavBuffer.writeUInt32LE(16, 16)
  wavBuffer.writeUInt16LE(1, 20)
  wavBuffer.writeUInt16LE(1, 22)
  wavBuffer.writeUInt32LE(44100, 24)
  wavBuffer.writeUInt32LE(88200, 28)
  wavBuffer.writeUInt16LE(2, 32)
  wavBuffer.writeUInt16LE(16, 34)
  wavBuffer.write('data', 36, 'ascii')
  wavBuffer.writeUInt32LE(20, 40)
  wavBuffer.fill(0x7f, 44, 64)

  const form = new FormData()
  form.append('file', wavBuffer, {
    filename: 'meeting-note.wav',
    contentType: 'audio/wav',
  })

  const uploadRes = await uploadNoteFile(app, accessToken, note.data.id, form)
  assert.strictEqual(uploadRes.statusCode, 201)
  const uploaded = uploadRes.json().files[0]
  registerFileCleanup(t, uploaded.fileId, uploaded.originalFilename)
  assert.strictEqual(uploaded.mimeType, 'audio/wav')
  assert.strictEqual(uploaded.size, 64)

  const partialRes = await app.inject({
    method: 'GET',
    url: `${ROUTE_PREFIX}/${uploaded.fileId}?noteId=${note.data.id}`,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Range: 'bytes=0-11',
    },
  })
  assert.strictEqual(partialRes.statusCode, 206)
  assert.strictEqual(partialRes.headers['content-type'], 'audio/wav')
  assert.strictEqual(partialRes.headers['content-range'], 'bytes 0-11/64')
  assert.strictEqual(partialRes.rawPayload.subarray(0, 4).toString('ascii'), 'RIFF')
  assert.strictEqual(partialRes.rawPayload.subarray(8, 12).toString('ascii'), 'WAVE')
})

test('DELETE /files/:fileId 204 & Quota 413 - Deletes single attachment with revision bump and enforces per-user storage quota', async (t) => {
  const userCtx = await setup(t, 'user', {
    USER_STORAGE_QUOTA_BYTES: 100,
  })
  const noteCreateRes = await userCtx.app.inject({
    method: 'POST',
    url: '/notes',
    headers: { Authorization: `Bearer ${userCtx.accessToken}` },
    payload: { title: 'Attachment Quota Note', body: 'Testing quota and delete' },
  })
  assert.strictEqual(noteCreateRes.statusCode, 201)
  const createdNote = noteCreateRes.json().data
  assert.strictEqual(createdNote.revision, 1)

  // Upload 60-byte file (within 100-byte quota) -> bumps note revision to 2
  const form1 = new FormData()
  form1.append('file', Buffer.alloc(60, 'a'), {
    filename: 'part1.txt',
    contentType: 'text/plain',
  })
  const upload1 = await uploadNoteFile(userCtx.app, userCtx.accessToken, createdNote.id, form1)
  assert.strictEqual(upload1.statusCode, 201)
  const file1 = upload1.json().files[0]
  const file1Path = registerFileCleanup(t, file1.fileId, file1.originalFilename)

  const afterUploadNoteRes = await userCtx.app.inject({
    method: 'GET',
    url: `/notes/${createdNote.id}`,
    headers: { Authorization: `Bearer ${userCtx.accessToken}` },
  })
  assert.strictEqual(afterUploadNoteRes.json().data.revision, 2)

  // Second upload of 50 bytes exceeds 100-byte quota -> rejected with 413
  const form2 = new FormData()
  form2.append('file', Buffer.alloc(50, 'b'), {
    filename: 'over-quota.txt',
    contentType: 'text/plain',
  })
  const upload2 = await uploadNoteFile(userCtx.app, userCtx.accessToken, createdNote.id, form2)
  assert.strictEqual(upload2.statusCode, 413)

  // Delete first attachment via DELETE /files/:fileId?noteId=... -> removes blob and bumps revision to 3
  const delFileRes = await userCtx.app.inject({
    method: 'DELETE',
    url: `${ROUTE_PREFIX}/${file1.fileId}?noteId=${createdNote.id}`,
    headers: { Authorization: `Bearer ${userCtx.accessToken}` },
  })
  assert.strictEqual(delFileRes.statusCode, 204)
  assert.strictEqual(await fileExists(file1Path), false)

  const afterDeleteNoteRes = await userCtx.app.inject({
    method: 'GET',
    url: `/notes/${createdNote.id}`,
    headers: { Authorization: `Bearer ${userCtx.accessToken}` },
  })
  assert.strictEqual(afterDeleteNoteRes.json().data.revision, 3)
  assert.deepStrictEqual(afterDeleteNoteRes.json().data.attachments, [])

  // Deleting an already-removed attachment returns 404
  const delAgainRes = await userCtx.app.inject({
    method: 'DELETE',
    url: `${ROUTE_PREFIX}/${file1.fileId}?noteId=${createdNote.id}`,
    headers: { Authorization: `Bearer ${userCtx.accessToken}` },
  })
  assert.strictEqual(delAgainRes.statusCode, 404)

  // Another user cannot delete an attachment on a note they do not own
  const intruderCtx = await setup(t, 'user')
  const intruderDelRes = await intruderCtx.app.inject({
    method: 'DELETE',
    url: `${ROUTE_PREFIX}/${file1.fileId}?noteId=${createdNote.id}`,
    headers: { Authorization: `Bearer ${intruderCtx.accessToken}` },
  })
  assert.strictEqual(intruderDelRes.statusCode, 404)
})

test('GET /files/:fileId 200 & 206 - Streams attachments uncompressed with exact Content-Length even when Accept-Encoding requests compression', async (t) => {
  const { app, accessToken, note } = await createNote(t)
  // > 1024 bytes so global @fastify/compress threshold (1024) would compress if not opted out
  const content = '0123456789ABCDEF'.repeat(128) // 2048 bytes
  const form = new FormData()
  const fileName = 'uncompressed-range.txt'
  form.append('file', Buffer.from(content), {
    filename: fileName,
    contentType: 'text/plain',
  })

  const uploadRes = await uploadNoteFile(app, accessToken, note.data.id, form)
  assert.strictEqual(uploadRes.statusCode, 201)
  const fileId = uploadRes.json().files[0].fileId
  registerFileCleanup(t, fileId, fileName)

  const fullRes = await app.inject({
    method: 'GET',
    url: `${ROUTE_PREFIX}/${fileId}?noteId=${note.data.id}`,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Accept-Encoding': 'br, gzip, deflate',
    },
  })
  assert.strictEqual(fullRes.statusCode, 200)
  assert.strictEqual(fullRes.headers['content-encoding'], undefined)
  assert.strictEqual(Number(fullRes.headers['content-length']), content.length)
  assert.strictEqual(fullRes.body, content)

  const rangeRes = await app.inject({
    method: 'GET',
    url: `${ROUTE_PREFIX}/${fileId}?noteId=${note.data.id}`,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Accept-Encoding': 'br, gzip, deflate',
      Range: 'bytes=0-1535',
    },
  })
  assert.strictEqual(rangeRes.statusCode, 206)
  assert.strictEqual(rangeRes.headers['content-encoding'], undefined)
  assert.strictEqual(rangeRes.headers['content-range'], `bytes 0-1535/${content.length}`)
  assert.strictEqual(Number(rangeRes.headers['content-length']), 1536)
  assert.strictEqual(rangeRes.body, content.slice(0, 1536))
})

test('POST /files/import 413 - Rejects CSV exceeding MAX_UPLOAD_BYTES without persisting partial Note rows', async (t) => {
  const userCtx = await setup(t, 'user', {
    MAX_UPLOAD_BYTES: 120,
  })

  const rows = [
    'title,body',
    '"First imported note","Short body 1"',
    '"Second imported note","Short body 2"',
    '"Third imported note","This row pushes the CSV well past 120 bytes of MAX_UPLOAD_BYTES"',
  ].join('\n')

  const form = new FormData()
  form.append('file', Buffer.from(rows, 'utf8'), {
    filename: 'oversized.csv',
    contentType: 'text/csv',
  })

  const importRes = await userCtx.app.inject({
    method: 'POST',
    url: `${ROUTE_PREFIX}/import`,
    headers: {
      Authorization: `Bearer ${userCtx.accessToken}`,
      ...form.getHeaders(),
    },
    payload: form,
  })

  assert.strictEqual(importRes.statusCode, 413)

  const listRes = await userCtx.app.inject({
    method: 'GET',
    url: '/notes',
    headers: { Authorization: `Bearer ${userCtx.accessToken}` },
  })
  assert.strictEqual(listRes.statusCode, 200)
  assert.strictEqual(listRes.json().totalCount, 0)
})
