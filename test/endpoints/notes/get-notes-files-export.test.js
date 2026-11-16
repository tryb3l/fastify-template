'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { createNote } = require('../../utils/note-creator')
const { buildMarkdownNote } = require('../../utils/markdown-note')
const { getGzipResponse, listenOnRandomPort } = require('../../utils/http-compression')
const { seedUser } = require('../../utils/setup-user')

describe('GET /files/export', () => {
  test('returns 200 streaming notes as text/csv with Content-Disposition and readiness columns', async (t) => {
    // Arrange
    const { app, accessToken, note } = await createNote(t, {
      title: 'Exported Note',
      body: 'Body text',
      readiness: 'mastered',
      noteType: 'post_mortem',
    })

    // Act
    const response = await app.inject({
      method: 'GET',
      url: '/files/export',
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.equal(response.headers['content-type'], 'text/csv')
    assert.ok(
      response.headers['content-disposition'].includes('attachment; filename="note-list.csv"'),
    )
    assert.ok(response.body.includes(note.data.title))
    assert.ok(response.body.includes('mastered'))
    assert.ok(response.body.includes('post_mortem'))
  })

  test('returns 200 exporting exact CSV header columns and empty-body rows', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    await actor.app.notesDataSource.createNote(
      {
        title: 'Round-Trip Note',
        body: '',
        tags: ['ops', 'q2'],
        readiness: 'in_progress',
        noteType: 'post_mortem',
      },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: '/files/export',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const lines = response.body.trim().split('\n')
    assert.equal(lines.length, 2)
    assert.equal(
      lines[0],
      '"title","body","tags","readiness","noteType","createdAt","modifiedAt","id"',
    )
    assert.ok(lines[1].includes('Round-Trip Note'))
    assert.ok(lines[1].includes('in_progress'))
    assert.ok(lines[1].includes('post_mortem'))
  })

  test('returns 200 compressed with gzip over HTTP for large CSV exports', async (t) => {
    // Arrange
    const markdownBody = buildMarkdownNote({ minLength: 32_000 })
    const { app, accessToken } = await createNote(t, {
      title: 'Compressed export note',
      body: markdownBody,
      tags: ['csv', 'gzip'],
    })
    const port = await listenOnRandomPort(app)

    // Act
    const response = await getGzipResponse({
      port,
      path: '/files/export',
      accessToken,
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.equal(response.headers['content-encoding'], 'gzip')
    assert.match(response.headers['content-type'], /^text\/csv/)
    assert.ok(response.body.includes('Compressed export note'))
    assert.ok(response.rawBody.length < Buffer.byteLength(response.body))
  })

  test('returns 200 exporting all notes beyond the default list limit of 10', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const rowCount = 55
    await actor.app.notesDataSource.createNotes(
      Array.from({ length: rowCount }, (_, index) => ({
        title: `Export Title ${index}`,
        body: `Export Body ${index}`,
        tags: [`tag${index}`],
      })),
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: '/files/export',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.equal(response.body.trim().split('\n').length, rowCount + 1)
    assert.ok(response.body.includes('Export Title 54'))
  })

  test('returns 200 sanitizing spreadsheet formula prefixes in exported CSV cells', async (t) => {
    // Arrange
    const formulaTitle = '=SUM(1,1)'
    const { app, accessToken } = await createNote(t, { title: formulaTitle })

    // Act
    const response = await app.inject({
      method: 'GET',
      url: '/files/export',
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.ok(response.body.includes(`"'${formulaTitle}"`))
    assert.equal(response.body.includes(`"${formulaTitle}"`), false)
  })

  test('returns 200 filtered by notebookId and folderId', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const notebook = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Scoped Export NB' },
      actor.userId,
    )
    const folder = await actor.app.notebooksDataSource.createFolder(
      { notebookId: notebook.id, name: 'Reports' },
      actor.userId,
    )
    await actor.app.notesDataSource.createNote(
      { title: 'Inbox Excluded Note', body: 'inbox' },
      actor.userId,
    )
    await actor.app.notesDataSource.createNote(
      {
        title: 'Scoped Folder Export',
        body: 'included',
        notebookId: notebook.id,
        folderId: folder.id,
      },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: `/files/export?notebookId=${notebook.id}&folderId=${folder.id}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.ok(response.body.includes('Scoped Folder Export'))
    assert.equal(response.body.includes('Inbox Excluded Note'), false)
  })

  test('returns 200 filtered by inbox when inbox=true', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const notebook = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Filed NB' },
      actor.userId,
    )
    await actor.app.notesDataSource.createNote(
      { title: 'Filed Export Excluded', body: 'filed', notebookId: notebook.id },
      actor.userId,
    )
    await actor.app.notesDataSource.createNote(
      { title: 'Inbox Export Included', body: 'inbox' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: '/files/export?inbox=true',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.ok(response.body.includes('Inbox Export Included'))
    assert.equal(response.body.includes('Filed Export Excluded'), false)
  })

  test('returns 200 and exports CSV rows for matching title filter', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    await actor.app.notesDataSource.createNote(
      { title: 'Alpha Summary', body: 'first' },
      actor.userId,
    )
    await actor.app.notesDataSource.createNote(
      { title: 'Beta Summary', body: 'second' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: '/files/export?title=Alpha',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.ok(response.body.includes('Alpha Summary'))
    assert.equal(response.body.includes('Beta Summary'), false)
  })

  test('returns 400 when notebookId query param is not a valid UUID', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: '/files/export?notebookId=not-a-uuid',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 401 when unauthenticated', async (t) => {
    // Arrange
    const { app } = await seedUser(t)

    // Act
    const response = await app.inject({
      method: 'GET',
      url: '/files/export',
    })

    // Assert
    assert.equal(response.statusCode, 401)
  })
})
