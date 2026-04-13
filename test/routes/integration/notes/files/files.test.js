'use strict'

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs/promises')
const path = require('node:path')
const FormData = require('form-data')
const { createNote } = require('../../../../utils/note-creator')
const { setup } = require('../../../../utils/setup-user')

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
  return [
    buildCsvRow(headers),
    ...rows.map((row) => buildCsvRow(row)),
  ].join('\n')
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
  const importResponse = await importNotesFile(app, accessToken, exportResponse.body, 'round-trip.csv')

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

test('POST /files/import 201 - Ignores metadata columns when importing CSV', async (t) => {
  // Arrange
  const { app, accessToken } = await setup(t, 'user')
  const csvContent = buildImportCsv(
    [[
      'Meta Title',
      'Meta Body',
      JSON.stringify(['tagA', 'tagB']),
      '2000-01-01T00:00:00.000Z',
      '2000-01-02T00:00:00.000Z',
      'legacy-id',
    ]],
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
  const csvContent = buildImportCsv([
    ['Broken Title', 'Broken Body', 'not-json'],
  ])

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
  assert.ok(response.headers['content-disposition'].includes('attachment; filename="note-list.csv"'))

  const csvOutput = response.body
  assert.ok(csvOutput.includes(note.data.title), 'Exported CSV should contain the created note title')
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
  assert.strictEqual(
    refreshedReadResponse.json().data.attachments[0].originalFilename,
    fileName,
  )
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
  const csvContent = buildImportCsv([
    ['Phase 1', 'Security', JSON.stringify(['auth'])],
  ])
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
  form.append('file', Buffer.from('console.log("hello")'), { filename: 'script.js', contentType: 'application/javascript' })

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
    headers: { Authorization: `Bearer ${accessToken}` }
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
  form.append('file', Buffer.alloc(10_000_001), { filename: 'oversized.txt', contentType: 'text/plain' })

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