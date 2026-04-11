'use strict'

const test = require('node:test')
const assert = require('node:assert')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')
const { assertUploadedFileContent } = require('../../utils/upload-verifier')

const PNG_SAMPLE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aMcAAAAASUVORK5CYII=',
  'base64',
)

async function createSampleFile(t, filename, content) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'upload-verifier-'))
  const filePath = path.join(tempDir, filename)

  await fs.writeFile(filePath, content)

  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  return filePath
}

test('assertUploadedFileContent accepts valid PNG content', async (t) => {
  const filePath = await createSampleFile(t, 'pixel.png', PNG_SAMPLE)

  await assert.doesNotReject(() => assertUploadedFileContent({
    filePath,
    filename: 'pixel.png',
    mimeType: 'image/png',
  }))
})

test('assertUploadedFileContent rejects random bytes masquerading as PNG', async (t) => {
  const filePath = await createSampleFile(t, 'fake.png', Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]))

  await assert.rejects(
    () => assertUploadedFileContent({
      filePath,
      filename: 'fake.png',
      mimeType: 'image/png',
    }),
    (error) => error.statusCode === 415,
  )
})

test('assertUploadedFileContent accepts UTF-8 CSV content', async (t) => {
  const filePath = await createSampleFile(t, 'notes.csv', 'title,body\nSafe Title,Safe Body\n')

  await assert.doesNotReject(() => assertUploadedFileContent({
    filePath,
    filename: 'notes.csv',
    mimeType: 'text/csv',
  }))
})

test('assertUploadedFileContent rejects binary bytes declared as text/plain', async (t) => {
  const filePath = await createSampleFile(t, 'binary.txt', PNG_SAMPLE)

  await assert.rejects(
    () => assertUploadedFileContent({
      filePath,
      filename: 'binary.txt',
      mimeType: 'text/plain',
    }),
    (error) => error.statusCode === 415,
  )
})