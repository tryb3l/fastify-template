'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUIDv7 } = require('node:crypto')
const { seedUser } = require('../../utils/setup-user')

describe('GET /notes/:id/backlinks', () => {
  test('returns 200 with incoming Note Links including container metadata and relation', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const notebook = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Knowledge Base' },
      actor.userId,
    )
    const folder = await actor.app.notebooksDataSource.createFolder(
      { notebookId: notebook.id, name: 'Patterns' },
      actor.userId,
    )
    const target = await actor.app.notesDataSource.createNote(
      { title: 'Fastify Core', body: 'Target' },
      actor.userId,
    )
    const wikiSource = await actor.app.notesDataSource.createNote(
      { title: 'Encapsulation', body: `Builds on [[${target.id}|Core Wiki]]` },
      actor.userId,
    )
    const explicitSource = await actor.app.notesDataSource.createNote(
      {
        title: 'Autohooks Pattern',
        body: `See [Core](note://${target.id})`,
        notebookId: notebook.id,
        folderId: folder.id,
        links: [{ targetId: target.id, relation: 'parent', label: 'Primary Dependency' }],
      },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: `/notes/${target.id}/backlinks`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const backlinks = response.json().data
    assert.equal(backlinks.length, 2)
    assert.deepEqual(
      new Set(backlinks.map((b) => b.sourceId)),
      new Set([wikiSource.id, explicitSource.id]),
    )
    const wikiEntry = backlinks.find((b) => b.sourceId === wikiSource.id)
    assert.equal(wikiEntry.relation, 'related')
    assert.equal(wikiEntry.label, 'Core Wiki')
    const explicitEntry = backlinks.find((b) => b.sourceId === explicitSource.id)
    assert.equal(explicitEntry.notebookId, notebook.id)
    assert.equal(explicitEntry.folderId, folder.id)
    assert.equal(explicitEntry.relation, 'parent')
    assert.equal(explicitEntry.label, 'Primary Dependency')
  })

  test('returns 200 with empty array when no notes reference target', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const target = await actor.app.notesDataSource.createNote(
      { title: 'Isolated Note', body: 'No inbound links' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: `/notes/${target.id}/backlinks`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.deepEqual(response.json().data, [])
  })

  test('returns 400 when note id param is not a valid UUID', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: '/notes/not-a-uuid/backlinks',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 401 when unauthenticated', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const note = await actor.app.notesDataSource.createNote(
      { title: 'Private', body: 'text' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: `/notes/${note.id}/backlinks`,
    })

    // Assert
    assert.equal(response.statusCode, 401)
  })

  test('returns 404 when note does not exist', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: `/notes/${randomUUIDv7()}/backlinks`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 404)
  })

  test('returns 404 when querying backlinks on another users note', async (t) => {
    // Arrange
    const owner = await seedUser(t)
    const intruder = await seedUser(t, { app: owner.app })
    const ownerNote = await owner.app.notesDataSource.createNote(
      { title: 'Owner Target', body: 'secret' },
      owner.userId,
    )

    // Act
    const response = await intruder.app.inject({
      method: 'GET',
      url: `/notes/${ownerNote.id}/backlinks`,
      headers: { Authorization: `Bearer ${intruder.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 404)
  })
})
