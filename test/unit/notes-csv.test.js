'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { Readable } = require('node:stream')
const {
  CSV_IMPORT_BATCH_SIZE,
  buildNoteImportHeaders,
  importNotesFromCsvStream,
  mapNoteImportRow,
} = require('../../utils/notes-csv')

test('buildNoteImportHeaders accepts importable and ignored metadata headers', () => {
  const headers = buildNoteImportHeaders([
    'title',
    'body',
    'tags',
    'readiness',
    'noteType',
    'createdAt',
    'modifiedAt',
    'id',
  ])

  assert.deepStrictEqual(headers, [
    'title',
    'body',
    'tags',
    'readiness',
    'noteType',
    'createdAt',
    'modifiedAt',
    'id',
  ])
})

test('buildNoteImportHeaders rejects unsupported headers', () => {
  assert.throws(
    () => buildNoteImportHeaders(['title', 'body', 'ownerEmail']),
    /Unsupported CSV header: ownerEmail/,
  )
})

test('mapNoteImportRow parses JSON tags, readiness, and noteType and ignores metadata columns', () => {
  const headers = buildNoteImportHeaders([
    'title',
    'body',
    'tags',
    'readiness',
    'noteType',
    'createdAt',
    'modifiedAt',
    'id',
  ])

  const note = mapNoteImportRow(
    headers,
    [
      'Quarterly plan',
      'Ship the feature',
      '["ops","q2"]',
      'mastered',
      'post_mortem',
      'old-created',
      'old-modified',
      'old-id',
    ],
    1,
  )

  assert.deepStrictEqual(note, {
    title: 'Quarterly plan',
    body: 'Ship the feature',
    tags: ['ops', 'q2'],
    readiness: 'mastered',
    noteType: 'post_mortem',
  })
})

test('mapNoteImportRow rejects invalid readiness or noteType values', () => {
  const headers = buildNoteImportHeaders(['title', 'body', 'readiness', 'noteType'])

  assert.throws(
    () => mapNoteImportRow(headers, ['Title', 'Body', 'invalid_readiness', 'standard'], 2),
    /Row 2: readiness must be one of: to_review, in_progress, mastered/,
  )

  assert.throws(
    () => mapNoteImportRow(headers, ['Title', 'Body', 'to_review', 'invalid_type'], 3),
    /Row 3: noteType must be one of: standard, post_mortem/,
  )
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
    readiness: 'to_review',
    noteType: 'standard',
  })
})

test('mapNoteImportRow accepts note bodies up to the 50000 character ceiling', () => {
  const headers = buildNoteImportHeaders(['title', 'body'])
  const body = 'x'.repeat(50000)

  assert.deepStrictEqual(mapNoteImportRow(headers, ['Large note', body], 4), {
    title: 'Large note',
    body,
    tags: [],
    readiness: 'to_review',
    noteType: 'standard',
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

test('importNotesFromCsvStream propagates upstream Readable errors without hanging', async () => {
  let step = 0
  const failingStream = new Readable({
    read() {
      step += 1
      if (step === 1) {
        this.push('title,body\n"First note","Body one"\n')
      } else {
        this.destroy(new Error('Upstream socket reset'))
      }
    },
  })

  await assert.rejects(
    () => importNotesFromCsvStream(failingStream, async () => ['id-1']),
    /Upstream socket reset/,
  )
})

test('importNotesFromCsvStream rejects with 413 when multipart stream is marked truncated', async () => {
  const truncatedStream = Readable.from(['title,body\n"Valid row","Before truncation"\n'])
  truncatedStream.truncated = true

  const persistedBatches = []
  await assert.rejects(
    () =>
      importNotesFromCsvStream(truncatedStream, async (batch) => {
        persistedBatches.push(batch)
        return ['id-1']
      }),
    (err) => {
      assert.strictEqual(err.statusCode, 413)
      return true
    },
  )

  assert.strictEqual(persistedBatches.length, 0)
})
