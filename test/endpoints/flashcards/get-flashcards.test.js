'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { setTimeout: delay } = require('node:timers/promises')
const { seedUser } = require('../../utils/setup-user')

describe('GET /flashcards', () => {
  test('returns 200 with flashcards sorted by createdAt ascending excluding internal fields', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const note = await actor.app.notesDataSource.createNote(
      { title: 'Card Host', body: 'text' },
      actor.userId,
    )
    const first = await actor.app.flashcardsDataSource.createFlashcard(
      { noteId: note.id, front: 'First Q', back: 'First A' },
      actor.userId,
    )
    await delay(15)
    const second = await actor.app.flashcardsDataSource.createFlashcard(
      { noteId: note.id, front: 'Second Q', back: 'Second A' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: '/flashcards',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const { data } = response.json()
    assert.equal(data.length, 2)
    assert.equal(data[0].id, first.id)
    assert.equal(data[1].id, second.id)
    assert.equal(Object.hasOwn(data[0], '_id'), false)
    assert.equal(Object.hasOwn(data[0], 'userId'), false)
  })

  test('returns 200 filtered by noteId', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const noteA = await actor.app.notesDataSource.createNote(
      { title: 'Note A', body: 'a' },
      actor.userId,
    )
    const noteB = await actor.app.notesDataSource.createNote(
      { title: 'Note B', body: 'b' },
      actor.userId,
    )
    const cardA = await actor.app.flashcardsDataSource.createFlashcard(
      { noteId: noteA.id, front: 'QA', back: 'AA' },
      actor.userId,
    )
    await actor.app.flashcardsDataSource.createFlashcard(
      { noteId: noteB.id, front: 'QB', back: 'AB' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: `/flashcards?noteId=${noteA.id}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const { data } = response.json()
    assert.equal(data.length, 1)
    assert.equal(data[0].id, cardA.id)
  })

  test('returns 200 filtered by notebookId and box including 1-hop external linked Note cards', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const canonicalNb = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Algorithms KB' },
      actor.userId,
    )
    const canonicalNote = await actor.app.notesDataSource.createNote(
      { title: 'Dijkstra', body: 'relaxation', notebookId: canonicalNb.id },
      actor.userId,
    )
    const campaign = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Onsite Prep', mode: 'campaign' },
      actor.userId,
    )
    const campaignNote = await actor.app.notesDataSource.createNote(
      {
        title: 'Routing Question',
        body: `Uses [[${canonicalNote.id}|Dijkstra]]`,
        notebookId: campaign.id,
      },
      actor.userId,
    )
    const cardInternal = await actor.app.flashcardsDataSource.createFlashcard(
      { noteId: campaignNote.id, front: 'Internal Q', back: 'Internal A' },
      actor.userId,
    )
    const cardExternal = await actor.app.flashcardsDataSource.createFlashcard(
      { noteId: canonicalNote.id, front: 'External Q', back: 'External A' },
      actor.userId,
    )
    const promotedCard = await actor.app.flashcardsDataSource.createFlashcard(
      { noteId: campaignNote.id, front: 'Box 2 Q', back: 'Box 2 A' },
      actor.userId,
    )
    await actor.app.flashcardsDataSource.reviewFlashcard(promotedCard.id, 'good', actor.userId)

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: `/flashcards?notebookId=${campaign.id}&box=1`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const { data } = response.json()
    assert.equal(data.length, 2)
    assert.deepEqual(new Set(data.map((c) => c.id)), new Set([cardInternal.id, cardExternal.id]))
  })

  test('returns 200 filtered by folderId spanning descendant subfolders', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const notebook = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Folder Cards NB' },
      actor.userId,
    )
    const parentFolder = await actor.app.notebooksDataSource.createFolder(
      { notebookId: notebook.id, name: 'Graphs' },
      actor.userId,
    )
    const childFolder = await actor.app.notebooksDataSource.createFolder(
      { notebookId: notebook.id, parentId: parentFolder.id, name: 'Shortest Paths' },
      actor.userId,
    )
    const nestedNote = await actor.app.notesDataSource.createNote(
      {
        title: 'Bellman-Ford',
        body: 'negative edges',
        notebookId: notebook.id,
        folderId: childFolder.id,
      },
      actor.userId,
    )
    const nestedCard = await actor.app.flashcardsDataSource.createFlashcard(
      { noteId: nestedNote.id, front: 'Complexity?', back: 'O(VE)' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: `/flashcards?folderId=${parentFolder.id}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.equal(response.json().data.length, 1)
    assert.equal(response.json().data[0].id, nestedCard.id)
  })

  test('returns 200 isolating flashcards from other users', async (t) => {
    // Arrange
    const owner = await seedUser(t)
    const otherUser = await seedUser(t, { app: owner.app })
    const ownerNote = await owner.app.notesDataSource.createNote(
      { title: 'Owner Note', body: 'secret' },
      owner.userId,
    )
    await owner.app.flashcardsDataSource.createFlashcard(
      { noteId: ownerNote.id, front: 'Secret Q', back: 'Secret A' },
      owner.userId,
    )

    // Act
    const response = await otherUser.app.inject({
      method: 'GET',
      url: '/flashcards',
      headers: { Authorization: `Bearer ${otherUser.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.deepEqual(response.json().data, [])
  })

  test('returns 400 when box query parameter is outside 1..5', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: '/flashcards?box=6',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 400 when noteId query parameter is not a valid UUID', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: '/flashcards?noteId=not-a-uuid',
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
      url: '/flashcards',
    })

    // Assert
    assert.equal(response.statusCode, 401)
  })

  test('returns 404 when filtering by a notebookId owned by another user', async (t) => {
    // Arrange
    const owner = await seedUser(t)
    const intruder = await seedUser(t, { app: owner.app })
    const ownerNb = await owner.app.notebooksDataSource.createNotebook(
      { name: 'Owner NB' },
      owner.userId,
    )

    // Act
    const response = await intruder.app.inject({
      method: 'GET',
      url: `/flashcards?notebookId=${ownerNb.id}`,
      headers: { Authorization: `Bearer ${intruder.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 404)
  })
})
