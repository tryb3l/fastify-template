'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const FormData = require('form-data')
const { buildMarkdownNote } = require('../../utils/markdown-note')
const { buildImportCsv, buildUploadForm } = require('../../utils/notes-files')
const { seedUser } = require('../../utils/setup-user')

describe('POST /files/import', () => {
  test('returns 201 and imports CSV rows with tags, readiness, and noteType', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const csvContent = buildImportCsv(
      [
        ['Test Title 1', 'Test Body 1', JSON.stringify(['tagA']), 'in_progress', 'standard'],
        [
          'Test Title 2',
          'Test Body 2',
          JSON.stringify(['tagB', 'tagC']),
          'mastered',
          'post_mortem',
        ],
      ],
      ['title', 'body', 'tags', 'readiness', 'noteType'],
    )
    const form = buildUploadForm(csvContent, { filename: 'import.csv', contentType: 'text/csv' })

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: '/files/import',
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${actor.accessToken}`,
      },
      payload: form,
    })

    // Assert
    assert.equal(response.statusCode, 201)
    const insertedIds = response.json()
    assert.equal(insertedIds.length, 2)
    const secondNote = await actor.app.notesDataSource.readNote(insertedIds[1], actor.userId)
    assert.equal(secondNote.readiness, 'mastered')
    assert.equal(secondNote.noteType, 'post_mortem')
    assert.deepEqual(secondNote.tags, ['tagB', 'tagC'])
  })

  test('returns 201 accepting empty body cells as empty strings', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const csvContent = buildImportCsv([['Empty body note', '', JSON.stringify(['draft'])]])
    const form = buildUploadForm(csvContent, {
      filename: 'empty-body.csv',
      contentType: 'text/csv',
    })

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: '/files/import',
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${actor.accessToken}`,
      },
      payload: form,
    })

    // Assert
    assert.equal(response.statusCode, 201)
    const [insertedId] = response.json()
    const created = await actor.app.notesDataSource.readNote(insertedId, actor.userId)
    assert.equal(created.body, '')
  })

  test('returns 201 preserving a large 32KB+ Markdown body unchanged', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const markdownBody = buildMarkdownNote({ minLength: 32_000 })
    const csvContent = buildImportCsv([
      ['Milkdown import note', markdownBody, JSON.stringify(['markdown', 'import'])],
    ])
    const form = buildUploadForm(csvContent, {
      filename: 'milkdown-import.csv',
      contentType: 'text/csv',
    })

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: '/files/import',
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${actor.accessToken}`,
      },
      payload: form,
    })

    // Assert
    assert.equal(response.statusCode, 201)
    const [insertedId] = response.json()
    const created = await actor.app.notesDataSource.readNote(insertedId, actor.userId)
    assert.equal(created.body, markdownBody)
  })

  test('returns 201 ignoring exported metadata columns (id, createdAt, modifiedAt)', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const csvContent = buildImportCsv(
      [
        [
          'Meta Title',
          'Meta Body',
          JSON.stringify(['tagA', 'tagB']),
          '2000-01-01T00:00:00.000Z',
          '2000-01-02T00:00:00.000Z',
          'legacy-id',
        ],
      ],
      ['title', 'body', 'tags', 'createdAt', 'modifiedAt', 'id'],
    )
    const form = buildUploadForm(csvContent, { filename: 'metadata.csv', contentType: 'text/csv' })

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: '/files/import',
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${actor.accessToken}`,
      },
      payload: form,
    })

    // Assert
    assert.equal(response.statusCode, 201)
    const [insertedId] = response.json()
    const importedNote = await actor.app.notesDataSource.readNote(insertedId, actor.userId)
    assert.notEqual(importedNote.id, 'legacy-id')
    assert.deepEqual(importedNote.tags, ['tagA', 'tagB'])
  })

  test('returns 201 importing inline wiki-links as Note Links on imported notes', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const targetNote = await actor.app.notesDataSource.createNote(
      { title: 'Existing Reference', body: 'target' },
      actor.userId,
    )
    const csvContent = buildImportCsv([
      [
        'Linked CSV Note',
        `Body referencing [[${targetNote.id}|Inbox Ref]]`,
        JSON.stringify(['csv']),
      ],
    ])
    const form = buildUploadForm(csvContent, {
      filename: 'linked-import.csv',
      contentType: 'text/csv',
    })

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: '/files/import',
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${actor.accessToken}`,
      },
      payload: form,
    })

    // Assert
    assert.equal(response.statusCode, 201)
    const [insertedId] = response.json()
    const imported = await actor.app.notesDataSource.readNote(insertedId, actor.userId)
    assert.deepEqual(imported.links, [
      { targetId: targetNote.id, relation: 'related', label: 'Inbox Ref' },
    ])
  })

  test('returns 201 scoping imported notes into Notebook and Folder when specified', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const notebook = await actor.app.notebooksDataSource.createNotebook(
      { name: 'CSV Imports' },
      actor.userId,
    )
    const folder = await actor.app.notebooksDataSource.createFolder(
      { notebookId: notebook.id, name: 'Batch' },
      actor.userId,
    )
    const csvContent = buildImportCsv([['Scoped Import', 'Inside folder', JSON.stringify(['csv'])]])
    const form = buildUploadForm(csvContent, { filename: 'scoped.csv', contentType: 'text/csv' })

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: `/files/import?notebookId=${notebook.id}&folderId=${folder.id}`,
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${actor.accessToken}`,
      },
      payload: form,
    })

    // Assert
    assert.equal(response.statusCode, 201)
    const [insertedId] = response.json()
    const imported = await actor.app.notesDataSource.readNote(insertedId, actor.userId)
    assert.equal(imported.notebookId, notebook.id)
    assert.equal(imported.folderId, folder.id)
  })

  test('returns 201 across 500-row batch boundaries', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const rowCount = 501
    const rows = Array.from({ length: rowCount }, (_, index) => [
      `Title ${index}`,
      `Body ${index}`,
      JSON.stringify([`t${index % 10}`]),
    ])
    const form = buildUploadForm(buildImportCsv(rows), {
      filename: 'batched-import.csv',
      contentType: 'text/csv',
    })

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: '/files/import',
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${actor.accessToken}`,
      },
      payload: form,
    })

    // Assert
    assert.equal(response.statusCode, 201)
    assert.equal(response.json().length, rowCount)
  })

  test('returns 400 when CSV tags cell is malformed JSON', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const csvContent = buildImportCsv([['Broken Title', 'Broken Body', 'not-json']])
    const form = buildUploadForm(csvContent, {
      filename: 'malformed-tags.csv',
      contentType: 'text/csv',
    })

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: '/files/import',
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${actor.accessToken}`,
      },
      payload: form,
    })

    // Assert
    assert.equal(response.statusCode, 400)
    assert.match(response.json().message, /tags must be a JSON array of strings/)
  })

  test('returns 400 when no file is included in multipart request', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const form = new FormData()

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: '/files/import',
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${actor.accessToken}`,
      },
      payload: form,
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 400 when folderId is provided without owning notebookId', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const notebook = await actor.app.notebooksDataSource.createNotebook(
      { name: 'NB' },
      actor.userId,
    )
    const folder = await actor.app.notebooksDataSource.createFolder(
      { notebookId: notebook.id, name: 'Folder' },
      actor.userId,
    )
    const form = buildUploadForm(buildImportCsv([['Note', 'Body', '[]']]), {
      filename: 'orphan.csv',
      contentType: 'text/csv',
    })

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: `/files/import?folderId=${folder.id}`,
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${actor.accessToken}`,
      },
      payload: form,
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 401 when unauthenticated', async (t) => {
    // Arrange
    const { app } = await seedUser(t)
    const form = buildUploadForm(buildImportCsv([['Phase 1', 'Security', '["auth"]']]), {
      filename: 'import.csv',
      contentType: 'text/csv',
    })

    // Act
    const response = await app.inject({
      method: 'POST',
      url: '/files/import',
      headers: form.getHeaders(),
      payload: form,
    })

    // Assert
    assert.equal(response.statusCode, 401)
  })

  test('returns 413 when CSV exceeds MAX_UPLOAD_BYTES without persisting partial rows', async (t) => {
    // Arrange
    const actor = await seedUser(t, { env: { MAX_UPLOAD_BYTES: 120 } })
    const rows = [
      'title,body',
      '"First imported note","Short body 1"',
      '"Second imported note","Short body 2"',
      '"Third imported note","This row pushes the CSV well past 120 bytes of MAX_UPLOAD_BYTES"',
    ].join('\n')
    const form = buildUploadForm(rows, { filename: 'oversized.csv', contentType: 'text/csv' })

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: '/files/import',
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${actor.accessToken}`,
      },
      payload: form,
    })

    // Assert
    assert.equal(response.statusCode, 413)
    const count = await actor.app.notesDataSource.countNotes({}, actor.userId)
    assert.equal(count, 0)
  })
})
