'use strict'

const { compose } = require('node:stream')
const { parse: csvParse } = require('csv-parse')
const { stringify: csvStringify } = require('csv-stringify')
const {
  CSV_EXPORT_COLUMNS,
  CSV_IGNORED_HEADERS,
  CSV_IMPORTABLE_HEADERS,
  CSV_REQUIRED_HEADERS,
  NOTE_CONSTRAINTS,
} = require('../routes/notes/note-contract')

const IMPORTABLE_NOTE_HEADERS = new Set(CSV_IMPORTABLE_HEADERS)
const IGNORED_NOTE_HEADERS = new Set(CSV_IGNORED_HEADERS)
const REQUIRED_NOTE_HEADERS = CSV_REQUIRED_HEADERS

const NOTE_TITLE_LIMITS = {
  min: NOTE_CONSTRAINTS.TITLE_MIN_LENGTH,
  max: NOTE_CONSTRAINTS.TITLE_MAX_LENGTH,
}
const NOTE_BODY_LIMITS = {
  min: NOTE_CONSTRAINTS.BODY_MIN_LENGTH,
  max: NOTE_CONSTRAINTS.BODY_MAX_LENGTH,
}
const NOTE_TAG_LIMITS = {
  min: NOTE_CONSTRAINTS.TAG_MIN_LENGTH,
  max: NOTE_CONSTRAINTS.TAG_MAX_LENGTH,
}

const CSV_IMPORT_BATCH_SIZE = 500
const DANGEROUS_CSV_PREFIX = /^[\t\r\n ]*[=+\-@]/

function sanitizeCsvCellValue(value) {
  if (typeof value !== 'string') {
    return value
  }

  // Prefix spreadsheet-formula-like cells at export time so spreadsheet apps do not execute formulas.
  if (DANGEROUS_CSV_PREFIX.test(value)) {
    return `'${value}`
  }

  return value
}

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

async function importNotesFromCsvStream(
  readableStream,
  onBatch,
  batchSize = CSV_IMPORT_BATCH_SIZE,
) {
  const insertedIds = []
  let pendingNotes = []
  let headers
  let rowNumber = 0

  const flushPendingNotes = async () => {
    if (pendingNotes.length === 0) {
      return
    }

    const batchIds = await onBatch(pendingNotes)
    insertedIds.push(...batchIds)
    pendingNotes = []
  }

  const csvStream = readableStream.pipe(
    csvParse({
      bom: true,
      skip_empty_lines: true,
      trim: true,
    }),
  )

  try {
    for await (const line of csvStream) {
      if (!headers) {
        headers = buildNoteImportHeaders(line)
        continue
      }

      rowNumber += 1
      pendingNotes.push(mapNoteImportRow(headers, line, rowNumber))

      if (pendingNotes.length >= batchSize) {
        await flushPendingNotes()
      }
    }
  } catch (err) {
    if (err.statusCode === 400 || err.code?.startsWith('CSV_')) {
      throw createCsvImportError(err.message)
    }

    throw err
  }

  if (!headers) {
    throw createCsvImportError('CSV must include a header row')
  }

  await flushPendingNotes()
  return insertedIds
}

function createNotesCsvExportStream(cursorStream) {
  return compose(
    cursorStream,
    csvStringify({
      quoted_string: true,
      header: true,
      columns: [...CSV_EXPORT_COLUMNS],
      cast: {
        date: (value) => value.toISOString(),
        object: (value) => sanitizeCsvCellValue(JSON.stringify(value)),
        string: (value) => sanitizeCsvCellValue(value),
      },
    }),
  )
}

module.exports = {
  CSV_EXPORT_COLUMNS,
  CSV_IMPORT_BATCH_SIZE,
  buildNoteImportHeaders,
  createNotesCsvExportStream,
  importNotesFromCsvStream,
  mapNoteImportRow,
  sanitizeCsvCellValue,
}
