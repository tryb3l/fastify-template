'use strict'

const test = require('node:test')
const assert = require('node:assert')
const {
  CSV_IMPORT_BATCH_SIZE,
  buildNoteImportHeaders,
  mapNoteImportRow,
} = require('../../utils/notes-csv')

test('buildNoteImportHeaders accepts importable and ignored metadata headers', () => {
  const headers = buildNoteImportHeaders(['title', 'body', 'tags', 'createdAt', 'modifiedAt', 'id'])

  assert.deepStrictEqual(headers, ['title', 'body', 'tags', 'createdAt', 'modifiedAt', 'id'])
})

test('buildNoteImportHeaders rejects unsupported headers', () => {
  assert.throws(
    () => buildNoteImportHeaders(['title', 'body', 'ownerEmail']),
    /Unsupported CSV header: ownerEmail/,
  )
})

test('mapNoteImportRow parses JSON tags and ignores metadata columns', () => {
  const headers = buildNoteImportHeaders(['title', 'body', 'tags', 'createdAt', 'modifiedAt', 'id'])

  const note = mapNoteImportRow(
    headers,
    ['Quarterly plan', 'Ship the feature', '["ops","q2"]', 'old-created', 'old-modified', 'old-id'],
    1,
  )

  assert.deepStrictEqual(note, {
    title: 'Quarterly plan',
    body: 'Ship the feature',
    tags: ['ops', 'q2'],
  })
})

test('mapNoteImportRow rejects malformed tags content', () => {
  const headers = buildNoteImportHeaders(['title', 'body', 'tags'])

  assert.throws(
    () => mapNoteImportRow(headers, ['Title', 'Body', 'not-json'], 3),
    /Row 3: tags must be a JSON array of strings/,
  )
})

test('mapNoteImportRow enforces note field constraints', () => {
  const headers = buildNoteImportHeaders(['title', 'body'])

  assert.throws(
    () => mapNoteImportRow(headers, ['', 'Body'], 2),
    /Row 2: title must be a string between 1 and 100 characters/,
  )
})

test('mapNoteImportRow accepts empty note bodies', () => {
  // Arrange
  const headers = buildNoteImportHeaders(['title', 'body'])

  // Act
  const note = mapNoteImportRow(headers, ['Empty body note', ''], 3)

  // Assert
  assert.deepStrictEqual(note, {
    title: 'Empty body note',
    body: '',
    tags: [],
  })
})

test('mapNoteImportRow accepts note bodies up to the 50000 character ceiling', () => {
  const headers = buildNoteImportHeaders(['title', 'body'])
  const body = 'x'.repeat(50000)

  assert.deepStrictEqual(mapNoteImportRow(headers, ['Large note', body], 4), {
    title: 'Large note',
    body,
    tags: [],
  })
})

test('mapNoteImportRow rejects note bodies above the 50000 character ceiling', () => {
  const headers = buildNoteImportHeaders(['title', 'body'])

  assert.throws(
    () => mapNoteImportRow(headers, ['Too large', 'x'.repeat(50001)], 5),
    /Row 5: body must be a string between 0 and 50000 characters/,
  )
})

test('CSV import batching uses the documented chunk size', () => {
  assert.strictEqual(CSV_IMPORT_BATCH_SIZE, 500)
})
