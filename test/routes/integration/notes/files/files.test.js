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
  const { app, accessToken } = await setup(t, 'user')
  const fileName = 'test-upload-file.txt'
  const fileContent = 'Hello, this is a raw file upload test!'

  const form = new FormData()
  form.append('file', Buffer.from(fileContent), { filename: fileName, contentType: 'text/plain' })

  // Act
  const response = await app.inject({
    method: 'POST',
    url: `${ROUTE_PREFIX}/upload`,
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

  const serverPath = path.join(process.cwd(), 'uploads', body.files[0])
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