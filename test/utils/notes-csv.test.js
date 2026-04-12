'use strict'

const test = require('node:test')
const assert = require('node:assert')
const {
    CSV_IMPORT_BATCH_SIZE,
    buildNoteImportHeaders,
    mapNoteImportRow,
} = require('../../utils/notes-csv')

test('buildNoteImportHeaders accepts importable and ignored metadata headers', () => {
    const headers = buildNoteImportHeaders([
        'title',
        'body',
        'tags',
        'createdAt',
        'modifiedAt',
        'id',
    ])

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

test('CSV import batching uses the documented chunk size', () => {
    assert.strictEqual(CSV_IMPORT_BATCH_SIZE, 500)
})