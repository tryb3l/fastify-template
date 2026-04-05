'use strict'

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs/promises')
const path = require('node:path')
const FormData = require('form-data')
const { createNote } = require('../../../../utils/note-creator')
const { setup } = require('../../../../utils/setup-user')

const ROUTE_PREFIX = '/files'

test('POST /files/import 201 - Successfully parses and imports CSV', async (t) => {
  // Arrange
  const { app, accessToken } = await setup(t, 'user')
  const csvContent = 'title,body,tags\nTest Title 1,Test Body 1,tagA\nTest Title 2,Test Body 2,tagB,tagC'
  const form = new FormData()
  form.append('file', Buffer.from(csvContent), 'import.csv')

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
  assert.strictEqual(response.statusCode, 201)
  const insertedIds = response.json()
  assert.strictEqual(Array.isArray(insertedIds), true)
  assert.strictEqual(insertedIds.length, 2, 'Should have imported exactly 2 notes')
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

test('POST /files/upload 201 - Successfully saves raw file to disk', async (t) => {
  // Arrange
  const { app, accessToken, note } = await createNote(t)
  const fileName = 'test-upload-file.txt'
  const fileContent = 'Hello, this is a raw file upload test!'

  const form = new FormData()
  form.append('file', Buffer.from(fileContent), { filename: fileName, contentType: 'text/plain' })

  // Act
  const response = await app.inject({
    method: 'POST',
    url: `${ROUTE_PREFIX}/upload?noteId=${note.data.id}`,
    headers: {
      ...form.getHeaders(),
      Authorization: `Bearer ${accessToken}`,
    },
    payload: form,
  })

  // Assert
  assert.strictEqual(response.statusCode, 201)
  const body = response.json()
  assert.strictEqual(body.message, 'Files uploaded successfully')
  assert.strictEqual(body.files.length, 1)
  assert.ok(body.files[0].fileId)
  assert.strictEqual(body.files[0].originalFilename, fileName)
  assert.strictEqual(body.files[0].mimeType, 'text/plain')

  const serverPath = path.join(process.cwd(), 'uploads', `${body.files[0].fileId}.txt`)
  const fileExists = await fs.access(serverPath).then(() => true).catch(() => false)
  assert.strictEqual(fileExists, true, 'File should exist in the uploads directory')

  // Cleanup
  if (fileExists) await fs.unlink(serverPath)
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

test('GET /files/:fileId 200 - Successfully streams binary content', async (t) => {
  // Arrange
  const { app, accessToken, note } = await createNote(t)
  const form = new FormData()
  form.append('file', Buffer.from('download-me'), { filename: 'download.txt', contentType: 'text/plain' })

  // Act
  const uploadRes = await app.inject({
    method: 'POST',
    url: `${ROUTE_PREFIX}/upload?noteId=${note.data.id}`,
    headers: { ...form.getHeaders(), Authorization: `Bearer ${accessToken}` },
    payload: form,
  })

  // Assert
  assert.strictEqual(uploadRes.statusCode, 201)
  const fileId = uploadRes.json().files[0].fileId

  // Act
  const downloadRes = await app.inject({
    method: 'GET',
    url: `${ROUTE_PREFIX}/${fileId}?noteId=${note.data.id}`,
    headers: { Authorization: `Bearer ${accessToken}` }
  })

  assert.strictEqual(downloadRes.statusCode, 200)
  assert.strictEqual(downloadRes.body, 'download-me')

  // Cleanup
  await fs.unlink(path.join(process.cwd(), 'uploads', `${fileId}.txt`))
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