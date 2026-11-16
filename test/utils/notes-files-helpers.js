'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const FormData = require('form-data')

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

function buildWavBuffer(payloadLength = 20) {
  const wavBuffer = Buffer.alloc(44 + payloadLength)
  wavBuffer.write('RIFF', 0, 'ascii')
  wavBuffer.writeUInt32LE(36 + payloadLength, 4)
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
  wavBuffer.writeUInt32LE(payloadLength, 40)
  wavBuffer.fill(0x7f, 44, 44 + payloadLength)
  return wavBuffer
}

function uploadFilePath(fileId, originalFilename, uploadDir = path.join(process.cwd(), 'uploads')) {
  const extension = path.extname(originalFilename) || '.bin'
  return path.join(uploadDir, `${fileId}${extension}`)
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

function registerFileCleanup(t, fileId, originalFilename, uploadDir) {
  const serverPath = uploadFilePath(fileId, originalFilename, uploadDir)
  t.after(async () => {
    await fs.unlink(serverPath).catch(() => {})
  })
  return serverPath
}

function buildUploadForm(content, { filename, contentType }) {
  const form = new FormData()
  form.append('file', Buffer.isBuffer(content) ? content : Buffer.from(content), {
    filename,
    contentType,
  })
  return form
}

async function uploadNoteAttachment(
  app,
  accessToken,
  noteId,
  content,
  { filename, contentType },
  t = null,
) {
  const form = buildUploadForm(content, { filename, contentType })
  const response = await app.inject({
    method: 'POST',
    url: `/files/upload?noteId=${noteId}`,
    headers: {
      ...form.getHeaders(),
      Authorization: `Bearer ${accessToken}`,
    },
    payload: form,
  })
  assert.equal(response.statusCode, 201, response.payload)
  const uploadedFile = response.json().files[0]
  const uploadDir = app.notesFileManager?.uploadDir
  const serverPath = t
    ? registerFileCleanup(t, uploadedFile.fileId, uploadedFile.originalFilename, uploadDir)
    : uploadFilePath(uploadedFile.fileId, uploadedFile.originalFilename, uploadDir)

  return { uploadedFile, serverPath, response }
}

module.exports = {
  PNG_SAMPLE,
  buildImportCsv,
  buildUploadForm,
  buildWavBuffer,
  fileExists,
  registerFileCleanup,
  uploadFilePath,
  uploadNoteAttachment,
}
