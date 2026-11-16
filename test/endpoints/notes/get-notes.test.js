'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { setTimeout: delay } = require('node:timers/promises')
const { createNote } = require('../../utils/note-creator')
const { seedUser } = require('../../utils/setup-user')

describe('GET /notes', () => {
  test('returns 200 with paginated list projection excluding body and attachments', async (t) => {
    // Arrange
    const { app, accessToken, note } = await createNote(t, {
      title: 'Architecture Notes',
      body: 'Body excluded from list projection',
      readiness: 'in_progress',
      noteType: 'post_mortem',
    })

    // Act
    const response = await app.inject({
      method: 'GET',
      url: '/notes',
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const payload = response.json()
    assert.ok(Array.isArray(payload.data))
    assert.equal(payload.data.length, 1)
    assert.equal(payload.totalCount, 1)
    assert.equal(payload.data[0].id, note.data.id)
    assert.equal(payload.data[0].title, 'Architecture Notes')
    assert.equal(payload.data[0].readiness, 'in_progress')
    assert.equal(payload.data[0].noteType, 'post_mortem')
    assert.equal(Object.hasOwn(payload.data[0], 'body'), false)
    assert.equal(Object.hasOwn(payload.data[0], 'attachments'), false)
  })

  test('returns 200 sorted by modifiedAt descending with pagination skip and limit', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    await actor.app.notesDataSource.createNote({ title: 'Older Note', body: 'first' }, actor.userId)
    await delay(15)
    await actor.app.notesDataSource.createNote(
      { title: 'Newer Note', body: 'second' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: '/notes?skip=0&limit=1',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const payload = response.json()
    assert.equal(payload.data.length, 1)
    assert.equal(payload.totalCount, 2)
    assert.equal(payload.data[0].title, 'Newer Note')
  })

  test('returns 200 with literal case-insensitive title match when query contains regex metacharacters and leading dollar signs', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const specialTitle = '[Draft] Cost $100 \\ $expr .* (v1.0+?)'
    await actor.app.notesDataSource.createNote(
      { title: 'Other Note', body: 'ignored' },
      actor.userId,
    )
    await actor.app.notesDataSource.createNote(
      { title: specialTitle, body: 'matched' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: `/notes?title=${encodeURIComponent('[draft] cost $100 \\ $EXPR .*')}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const payload = response.json()
    assert.equal(payload.totalCount, 1)
    assert.equal(payload.data[0].title, specialTitle)
  })

  test('returns 200 with zero results for unmatched leading dollar field-path strings', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    await actor.app.notesDataSource.createNote({ title: 'Plain Note', body: 'text' }, actor.userId)

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: `/notes?title=${encodeURIComponent('$a..b')}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.equal(response.json().data.length, 0)
    assert.equal(response.json().totalCount, 0)
  })

  test('returns 200 filtered by inbox when inbox=true', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const notebook = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Systems' },
      actor.userId,
    )
    await actor.app.notesDataSource.createNote(
      { title: 'Filed Note', body: 'inside notebook', notebookId: notebook.id },
      actor.userId,
    )
    const inboxNote = await actor.app.notesDataSource.createNote(
      { title: 'Inbox Mastered', body: 'unfiled', readiness: 'mastered' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: '/notes?inbox=true',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const payload = response.json()
    assert.equal(payload.totalCount, 1)
    assert.equal(payload.data[0].id, inboxNote.id)
    assert.equal(payload.data[0].title, 'Inbox Mastered')
  })

  test('returns 200 filtered by readiness, noteType, notebookId, and folderId', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const notebook = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Systems' },
      actor.userId,
    )
    const folder = await actor.app.notebooksDataSource.createFolder(
      { notebookId: notebook.id, name: 'Debriefs' },
      actor.userId,
    )
    await actor.app.notesDataSource.createNote(
      { title: 'Inbox Mastered', body: 'x', readiness: 'mastered' },
      actor.userId,
    )
    const target = await actor.app.notesDataSource.createNote(
      {
        title: 'Campaign Post-Mortem',
        body: 'debrief',
        notebookId: notebook.id,
        folderId: folder.id,
        noteType: 'post_mortem',
      },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: `/notes?notebookId=${notebook.id}&folderId=${folder.id}&noteType=post_mortem&readiness=to_review`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const payload = response.json()
    assert.equal(payload.totalCount, 1)
    assert.equal(payload.data[0].id, target.id)
  })

  test('returns 200 filtered by notebookId only when folderId is omitted', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const notebookA = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Notebook A' },
      actor.userId,
    )
    const notebookB = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Notebook B' },
      actor.userId,
    )
    const noteA = await actor.app.notesDataSource.createNote(
      { title: 'Note A', body: 'a', notebookId: notebookA.id },
      actor.userId,
    )
    await actor.app.notesDataSource.createNote(
      { title: 'Note B', body: 'b', notebookId: notebookB.id },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: `/notes?notebookId=${notebookA.id}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const payload = response.json()
    assert.equal(payload.totalCount, 1)
    assert.equal(payload.data[0].id, noteA.id)
  })

  test('returns 200 isolating notes from other users', async (t) => {
    // Arrange
    const owner = await createNote(t, { title: 'Owner Secret Note' })
    const otherUser = await seedUser(t, { app: owner.app })

    // Act
    const response = await otherUser.app.inject({
      method: 'GET',
      url: '/notes',
      headers: { Authorization: `Bearer ${otherUser.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.deepEqual(response.json().data, [])
    assert.equal(response.json().totalCount, 0)
  })

  test('returns 400 when skip or limit is negative', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: '/notes?skip=-1&limit=-5',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 400 when skip or limit exceeds schema maximums', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: '/notes?skip=101&limit=101',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 400 when title filter exceeds 100 characters', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: `/notes?title=${encodeURIComponent('a'.repeat(101))}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 400 when notebookId filter is not a valid UUID', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: '/notes?notebookId=not-a-uuid',
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
      url: '/notes',
    })

    // Assert
    assert.equal(response.statusCode, 401)
  })
})
