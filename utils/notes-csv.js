'use strict'

const IMPORTABLE_NOTE_HEADERS = new Set(['title', 'body', 'tags'])
const IGNORED_NOTE_HEADERS = new Set(['createdAt', 'modifiedAt', 'id'])
const REQUIRED_NOTE_HEADERS = ['title', 'body']

const NOTE_TITLE_LIMITS = { min: 1, max: 100 }
const NOTE_BODY_LIMITS = { min: 1, max: 50000 }
const NOTE_TAG_LIMITS = { min: 1, max: 10 }

const CSV_IMPORT_BATCH_SIZE = 500

function createCsvImportError(message) {
  const error = new Error(message)
  error.statusCode = 400
  return error
}

function normalizeHeaderName(header) {
  if (typeof header !== 'string') {
    return ''
  }

  return header.trim()
}

function buildNoteImportHeaders(rawHeaders) {
  if (!Array.isArray(rawHeaders) || rawHeaders.length === 0) {
    throw createCsvImportError('CSV must include a header row')
  }

  const normalizedHeaders = rawHeaders.map(normalizeHeaderName)
  const seenHeaders = new Set()

  for (const header of normalizedHeaders) {
    if (!header) {
      throw createCsvImportError('CSV contains an empty header name')
    }

    if (seenHeaders.has(header)) {
      throw createCsvImportError(`CSV contains duplicate header: ${header}`)
    }

    if (!IMPORTABLE_NOTE_HEADERS.has(header) && !IGNORED_NOTE_HEADERS.has(header)) {
      throw createCsvImportError(`Unsupported CSV header: ${header}`)
    }

    seenHeaders.add(header)
  }

  for (const header of REQUIRED_NOTE_HEADERS) {
    if (!seenHeaders.has(header)) {
      throw createCsvImportError('CSV must include required headers: title, body')
    }
  }

  return normalizedHeaders
}

function assertStringField(name, value, rowNumber, { min, max }) {
  if (typeof value !== 'string' || value.length < min || value.length > max) {
    throw createCsvImportError(
      `Row ${rowNumber}: ${name} must be a string between ${min} and ${max} characters`,
    )
  }

  return value
}

function parseTagsCell(value, rowNumber) {
  if (value === undefined || value === null || value === '') {
    return []
  }

  let parsedValue

  try {
    parsedValue = JSON.parse(value)
  } catch {
    throw createCsvImportError(`Row ${rowNumber}: tags must be a JSON array of strings`)
  }

  if (!Array.isArray(parsedValue)) {
    throw createCsvImportError(`Row ${rowNumber}: tags must be a JSON array of strings`)
  }

  for (const tag of parsedValue) {
    if (
      typeof tag !== 'string' ||
      tag.length < NOTE_TAG_LIMITS.min ||
      tag.length > NOTE_TAG_LIMITS.max
    ) {
      throw createCsvImportError(
        `Row ${rowNumber}: tags must be an array of strings between ${NOTE_TAG_LIMITS.min} and ${NOTE_TAG_LIMITS.max} characters`,
      )
    }
  }

  return parsedValue
}

function mapNoteImportRow(headers, row, rowNumber) {
  if (!Array.isArray(headers) || headers.length === 0) {
    throw createCsvImportError('CSV must include a header row')
  }

  if (!Array.isArray(row) || row.length !== headers.length) {
    throw createCsvImportError(`Row ${rowNumber}: column count does not match the header row`)
  }

  const rawRecord = {}

  for (const [index, header] of headers.entries()) {
    if (IMPORTABLE_NOTE_HEADERS.has(header)) {
      rawRecord[header] = row[index]
    }
  }

  return {
    title: assertStringField('title', rawRecord.title, rowNumber, NOTE_TITLE_LIMITS),
    body: assertStringField('body', rawRecord.body, rowNumber, NOTE_BODY_LIMITS),
    tags: parseTagsCell(rawRecord.tags, rowNumber),
  }
}

module.exports = {
  CSV_IMPORT_BATCH_SIZE,
  buildNoteImportHeaders,
  mapNoteImportRow,
}