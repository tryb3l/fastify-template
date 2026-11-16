'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUIDv7 } = require('node:crypto')
const { randomString } = require('../../utils/data-creator')
const { buildMarkdownNote } = require('../../utils/markdown-note')
const { seedUser } = require('../../utils/setup-user')

describe('POST /notes', () => {
  test('returns 201 and creates a note with defaults, revision 1, and metadata', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const noteTitle = randomString(10)
    const noteBody = randomString(20)
    const noteTags = [randomString(5)]

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: '/notes',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: {
        title: noteTitle,
        body: noteBody,
        tags: noteTags,
      },
    })

    // Assert
    assert.equal(response.statusCode, 201)
    const created = response.json().data
    assert.ok(created.id)
    assert.equal(created.revision, 1)
    assert.equal(created.title, noteTitle)
    assert.equal(created.body, noteBody)
    assert.deepEqual(created.tags, noteTags)
    assert.equal(created.readiness, 'to_review')
    assert.equal(created.noteType, 'standard')
    assert.equal(created.notebookId, null)
    assert.equal(created.folderId, null)
  })

  test('returns 201 with readiness, noteType, container placement, and merged Note Links', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const notebook = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Interview Prep', mode: 'campaign' },
      actor.userId,
    )
    const folder = await actor.app.notebooksDataSource.createFolder(
      { notebookId: notebook.id, name: 'Debriefs' },
      actor.userId,
    )
    const targetNote = await actor.app.notesDataSource.createNote(
      { title: 'Target Concept', body: 'Reference' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: '/notes',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: {
        title: 'Post-Mortem Debrief',
        body: `See [[${targetNote.id}|Concept Wiki]]`,
        readiness: 'in_progress',
        noteType: 'post_mortem',
        notebookId: notebook.id,
        folderId: folder.id,
        links: [{ targetId: targetNote.id, relation: 'parent', label: 'Primary Parent' }],
      },
    })

    // Assert
    assert.equal(response.statusCode, 201)
    const created = response.json().data
    assert.equal(created.readiness, 'in_progress')
    assert.equal(created.noteType, 'post_mortem')
    assert.equal(created.notebookId, notebook.id)
    assert.equal(created.folderId, folder.id)
    assert.deepEqual(created.links, [
      { targetId: targetNote.id, relation: 'parent', label: 'Primary Parent' },
    ])
  })

  test('returns 201 preserving a large 32KB+ Markdown document unchanged', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const noteBody = buildMarkdownNote({ minLength: 32_000 })

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: '/notes',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: {
        title: 'Milkdown draft',
        body: noteBody,
        tags: ['markdown', 'draft'],
      },
    })

    // Assert
    assert.equal(response.statusCode, 201)
    const created = response.json().data
    assert.equal(created.body, noteBody)
    assert.ok(created.body.length >= 32_000)
  })

  test('returns 201 and accepts a note body at the 50000 character boundary', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const noteBody = 'b'.repeat(50_000)

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: '/notes',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: {
        title: 'Boundary body accepted',
        body: noteBody,
        tags: ['boundary'],
      },
    })

    // Assert
    assert.equal(response.statusCode, 201)
    assert.equal(response.json().data.body, noteBody)
  })

  test('returns 201 when body is omitted and defaults to empty string', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: '/notes',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: {
        title: 'Valid Title',
        tags: ['tag1'],
      },
    })

    // Assert
    assert.equal(response.statusCode, 201)
    assert.equal(response.json().data.body, '')
  })

  test('returns 201 when body is explicitly empty string', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: '/notes',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: {
        title: 'Title Only Stub',
        body: '',
        tags: ['stub'],
      },
    })

    // Assert
    assert.equal(response.statusCode, 201)
    assert.equal(response.json().data.body, '')
  })

  test('returns 400 when required title is missing', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: '/notes',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: {
        body: 'Some body text',
        tags: ['tag1'],
      },
    })

    // Assert
    assert.equal(response.statusCode, 400)
    assert.ok(response.json().message)
  })

  test('returns 400 when note body exceeds the 50000 character limit', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: '/notes',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: {
        title: 'Boundary body rejected',
        body: 'b'.repeat(50_001),
      },
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 400 when folderId is supplied without owning notebookId', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const notebook = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Container' },
      actor.userId,
    )
    const folder = await actor.app.notebooksDataSource.createFolder(
      { notebookId: notebook.id, name: 'Subfolder' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: '/notes',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: {
        title: 'Orphan folder placement',
        folderId: folder.id,
      },
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 400 when folderId belongs to a different notebook', async (t) => {
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
    const folderInA = await actor.app.notebooksDataSource.createFolder(
      { notebookId: notebookA.id, name: 'Folder A' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: '/notes',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: {
        title: 'Mismatched container',
        notebookId: notebookB.id,
        folderId: folderInA.id,
      },
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 401 when unauthenticated', async (t) => {
    // Arrange
    const { app } = await seedUser(t)

    // Act
    const response = await app.inject({
      method: 'POST',
      url: '/notes',
      payload: {
        title: 'Unauthorized Note',
        body: 'Should not exist',
      },
    })

    // Assert
    assert.equal(response.statusCode, 401)
  })

  test('returns 404 when filing into a notebook owned by another user', async (t) => {
    // Arrange
    const owner = await seedUser(t)
    const intruder = await seedUser(t, { app: owner.app })
    const ownerNotebook = await owner.app.notebooksDataSource.createNotebook(
      { name: 'Private Notebook' },
      owner.userId,
    )

    // Act
    const response = await intruder.app.inject({
      method: 'POST',
      url: '/notes',
      headers: { Authorization: `Bearer ${intruder.accessToken}` },
      payload: {
        title: 'Cross-tenant write attempt',
        notebookId: ownerNotebook.id,
      },
    })

    // Assert
    assert.equal(response.statusCode, 404)
  })

  test('returns 404 when a Note Link target note does not exist', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: '/notes',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: {
        title: 'Broken link target',
        links: [{ targetId: randomUUIDv7(), relation: 'related' }],
      },
    })

    // Assert
    assert.equal(response.statusCode, 404)
  })
})
