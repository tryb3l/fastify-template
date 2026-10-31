'use strict'

const { open } = require('node:fs/promises')

const ALLOWED_UPLOAD_MIME_TYPES = {
  'image/png': '.png',
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': '.webp',
  'image/gif': '.gif',
  'application/pdf': '.pdf',
  'text/csv': '.csv',
  'text/plain': '.txt',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'audio/mpeg': ['.mp3'],
  'audio/wav': ['.wav'],
  'audio/x-wav': ['.wav'],
  'audio/ogg': ['.ogg', '.oga'],
  'audio/mp4': ['.m4a', '.mp4'],
  'audio/x-m4a': ['.m4a', '.mp4'],
  'audio/webm': ['.weba', '.webm'],
  'video/mp4': ['.mp4', '.m4v'],
  'video/webm': ['.webm'],
}

const COMPATIBLE_DETECTED_MIMES = {
  'audio/wav': new Set(['audio/wav', 'audio/x-wav', 'audio/vnd.wave', 'audio/wave']),
  'audio/x-wav': new Set(['audio/wav', 'audio/x-wav', 'audio/vnd.wave', 'audio/wave']),
  'audio/mp4': new Set(['audio/mp4', 'audio/x-m4a', 'video/mp4']),
  'audio/x-m4a': new Set(['audio/mp4', 'audio/x-m4a', 'video/mp4']),
  'video/mp4': new Set(['video/mp4', 'audio/mp4', 'audio/x-m4a']),
  'audio/webm': new Set(['audio/webm', 'video/webm']),
  'video/webm': new Set(['video/webm', 'audio/webm']),
  'audio/ogg': new Set(['audio/ogg', 'application/ogg', 'video/ogg']),
  'audio/mpeg': new Set(['audio/mpeg', 'audio/mp3']),
}

const TEXT_LIKE_MIME_TYPES = new Set(['text/plain', 'text/csv'])
const BINARY_SIGNATURE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/mp4',
  'audio/x-m4a',
  'audio/webm',
  'video/mp4',
  'video/webm',
])
const ALLOWED_TEXT_CONTROL_BYTES = new Set([0x09, 0x0a, 0x0c, 0x0d])
const TEXT_SAMPLE_SIZE = 4096

let fileTypeModulePromise

function createVerificationError(message, statusCode = 415) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function normalizeAllowedExtensions(allowedExtensions) {
  return Array.isArray(allowedExtensions) ? allowedExtensions : [allowedExtensions]
}

async function loadFileTypeModule() {
  if (!fileTypeModulePromise) {
    fileTypeModulePromise = import('file-type')
  }

  return fileTypeModulePromise
}

async function readFileSample(filePath, bytesToRead = TEXT_SAMPLE_SIZE) {
  await using fileHandle = await open(filePath, 'r')
  const buffer = Buffer.allocUnsafe(bytesToRead)
  const { bytesRead } = await fileHandle.read(buffer, 0, bytesToRead, 0)
  return buffer.subarray(0, bytesRead)
}

function hasSuspiciousControlCharacters(sample) {
  let suspiciousCount = 0

  for (const byte of sample) {
    if (byte === 0x00) {
      return true
    }

    if ((byte < 0x20 && !ALLOWED_TEXT_CONTROL_BYTES.has(byte)) || byte === 0x7f) {
      suspiciousCount += 1
    }
  }

  return sample.length > 0 && suspiciousCount / sample.length > 0.02
}

function assertTextLikeContent(sample, filename, mimeType) {
  if (sample.includes(0x00)) {
    throw createVerificationError(
      `Uploaded file content does not match declared type ${mimeType}: ${filename}`,
    )
  }

  try {
    new TextDecoder('utf-8', { fatal: true }).decode(sample)
  } catch {
    throw createVerificationError(
      `Uploaded file content does not match declared type ${mimeType}: ${filename}`,
    )
  }

  if (hasSuspiciousControlCharacters(sample)) {
    throw createVerificationError(
      `Uploaded file content does not match declared type ${mimeType}: ${filename}`,
    )
  }
}

async function assertBinaryContent(filePath, filename, mimeType) {
  const allowedExtensions = normalizeAllowedExtensions(ALLOWED_UPLOAD_MIME_TYPES[mimeType])
  const { fileTypeFromFile } = await loadFileTypeModule()
  const detectedType = await fileTypeFromFile(filePath)

  if (!detectedType) {
    throw createVerificationError(
      `Uploaded file content does not match declared type ${mimeType}: ${filename}`,
    )
  }

  const detectedExtension = `.${detectedType.ext.toLowerCase()}`
  const compatibleMimes = COMPATIBLE_DETECTED_MIMES[mimeType]
  const mimeMatches = compatibleMimes
    ? compatibleMimes.has(detectedType.mime)
    : detectedType.mime === mimeType
  const extensionMatches = allowedExtensions.includes(detectedExtension)

  if (!mimeMatches || !extensionMatches) {
    throw createVerificationError(
      `Uploaded file content does not match declared type ${mimeType}: ${filename}`,
    )
  }
}

async function assertUploadedFileContent({ filePath, filename, mimeType }) {
  if (!ALLOWED_UPLOAD_MIME_TYPES[mimeType]) {
    throw createVerificationError(`File type not allowed: ${filename}`)
  }

  if (BINARY_SIGNATURE_MIME_TYPES.has(mimeType)) {
    await assertBinaryContent(filePath, filename, mimeType)
    return
  }

  if (TEXT_LIKE_MIME_TYPES.has(mimeType)) {
    const sample = await readFileSample(filePath)
    assertTextLikeContent(sample, filename, mimeType)
    return
  }

  throw createVerificationError(`File type not allowed: ${filename}`)
}

module.exports = {
  ALLOWED_UPLOAD_MIME_TYPES,
  assertUploadedFileContent,
}
