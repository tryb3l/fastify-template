'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUIDv7 } = require('node:crypto')
const { setTimeout: delay } = require('node:timers/promises')
const { seedUser } = require('../../utils/setup-user')

describe('GET /flashcards/drill', () => {
  test('returns 200 with due cards only in scheduled mode', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const note = await actor.app.notesDataSource.createNote(
      { title: 'Event Loop Phases', body: 'timers, poll, check' },
      actor.userId,
    )
    const futureCard = await actor.app.flashcardsDataSource.createFlashcard(
      { noteId: note.id, front: 'Reviewed Q', back: 'Reviewed A' },
      actor.userId,
    )
    const dueCard = await actor.app.flashcardsDataSource.createFlashcard(
      { noteId: note.id, front: 'Due Q', back: 'Due A' },
      actor.userId,
    )
    await actor.app.flashcardsDataSource.reviewFlashcard(futureCard.id, 'good', actor.userId)

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: `/flashcards/drill?noteId=${note.id}&mode=scheduled`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const cards = response.json().data
    assert.equal(cards.length, 1)
    assert.equal(cards[0].id, dueCard.id)
    assert.equal(cards[0].noteTitle, 'Event Loop Phases')
  })

  test('returns 200 with all cards in cram_all mode sorted by weakest_first', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const note = await actor.app.notesDataSource.createNote(
      { title: 'Cram Note', body: 'text' },
      actor.userId,
    )
    const cardBox2 = await actor.app.flashcardsDataSource.createFlashcard(
      { noteId: note.id, front: 'First Created (Box 2)', back: 'A1' },
      actor.userId,
    )
    await delay(15)
    const cardBox1 = await actor.app.flashcardsDataSource.createFlashcard(
      { noteId: note.id, front: 'Second Created (Box 1)', back: 'A2' },
      actor.userId,
    )
    await actor.app.flashcardsDataSource.reviewFlashcard(cardBox2.id, 'good', actor.userId)

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: `/flashcards/drill?noteId=${note.id}&mode=cram_all&order=weakest_first`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.deepEqual(
      response.json().data.map((c) => c.id),
      [cardBox1.id, cardBox2.id],
    )
  })

  test('returns 200 in cram_all mode sorted by sequential creation order', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const note = await actor.app.notesDataSource.createNote(
      { title: 'Sequential Drill Note', body: 'text' },
      actor.userId,
    )
    const cardFirst = await actor.app.flashcardsDataSource.createFlashcard(
      { noteId: note.id, front: 'First Q', back: 'A1' },
      actor.userId,
    )
    await delay(15)
    const cardSecond = await actor.app.flashcardsDataSource.createFlashcard(
      { noteId: note.id, front: 'Second Q', back: 'A2' },
      actor.userId,
    )
    await actor.app.flashcardsDataSource.reviewFlashcard(cardFirst.id, 'good', actor.userId)

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: `/flashcards/drill?noteId=${note.id}&mode=cram_all&order=sequential`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.deepEqual(
      response.json().data.map((c) => c.id),
      [cardFirst.id, cardSecond.id],
    )
  })

  test('returns 200 in cram_all mode with shuffled order bounded by limit', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const note = await actor.app.notesDataSource.createNote(
      { title: 'Shuffled Drill Note', body: 'text' },
      actor.userId,
    )
    const c1 = await actor.app.flashcardsDataSource.createFlashcard(
      { noteId: note.id, front: 'Q1', back: 'A1' },
      actor.userId,
    )
    const c2 = await actor.app.flashcardsDataSource.createFlashcard(
      { noteId: note.id, front: 'Q2', back: 'A2' },
      actor.userId,
    )
    const c3 = await actor.app.flashcardsDataSource.createFlashcard(
      { noteId: note.id, front: 'Q3', back: 'A3' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: `/flashcards/drill?noteId=${note.id}&mode=cram_all&order=shuffled&limit=2`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const returned = response.json().data
    assert.equal(returned.length, 2)
    const validIds = new Set([c1.id, c2.id, c3.id])
    for (const card of returned) {
      assert.equal(validIds.has(card.id), true)
    }
  })

  test('returns 200 expanding 1-hop external linked Note cards with isExternal and homeNotebookId when scoped to notebookId', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const canonicalNb = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Algorithms KB', mode: 'notebook' },
      actor.userId,
    )
    const canonicalNote = await actor.app.notesDataSource.createNote(
      { title: 'Dijkstra Shortest Path', body: 'Priority queue', notebookId: canonicalNb.id },
      actor.userId,
    )
    const campaign = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Onsite Loop Prep', mode: 'campaign' },
      actor.userId,
    )
    const campaignNote = await actor.app.notesDataSource.createNote(
      {
        title: 'Network Routing Question',
        body: `Uses [[${canonicalNote.id}|Dijkstra]]`,
        notebookId: campaign.id,
      },
      actor.userId,
    )
    const internalCard = await actor.app.flashcardsDataSource.createFlashcard(
      { noteId: campaignNote.id, front: 'Internal Q', back: 'Internal A' },
      actor.userId,
    )
    const externalCard = await actor.app.flashcardsDataSource.createFlashcard(
      { noteId: canonicalNote.id, front: 'External Q', back: 'External A' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: `/flashcards/drill?notebookId=${campaign.id}&mode=scheduled`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const cards = response.json().data
    assert.equal(cards.length, 2)
    const internalItem = cards.find((c) => c.id === internalCard.id)
    const externalItem = cards.find((c) => c.id === externalCard.id)
    assert.equal(internalItem.isExternal, false)
    assert.equal(internalItem.homeNotebookId, campaign.id)
    assert.equal(internalItem.noteTitle, 'Network Routing Question')
    assert.equal(externalItem.isExternal, true)
    assert.equal(externalItem.homeNotebookId, canonicalNb.id)
    assert.equal(externalItem.noteTitle, 'Dijkstra Shortest Path')
  })

  test('returns 200 excluding 1-hop external cards when includeExternal=false', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const canonicalNb = await actor.app.notebooksDataSource.createNotebook(
      { name: 'KB' },
      actor.userId,
    )
    const canonicalNote = await actor.app.notesDataSource.createNote(
      { title: 'External Note', body: 'ext', notebookId: canonicalNb.id },
      actor.userId,
    )
    const campaign = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Campaign', mode: 'campaign' },
      actor.userId,
    )
    const campaignNote = await actor.app.notesDataSource.createNote(
      { title: 'Internal Note', body: `Ref [[${canonicalNote.id}]]`, notebookId: campaign.id },
      actor.userId,
    )
    const internalCard = await actor.app.flashcardsDataSource.createFlashcard(
      { noteId: campaignNote.id, front: 'Internal Q', back: 'Internal A' },
      actor.userId,
    )
    await actor.app.flashcardsDataSource.createFlashcard(
      { noteId: canonicalNote.id, front: 'External Q', back: 'External A' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: `/flashcards/drill?notebookId=${campaign.id}&mode=scheduled&includeExternal=false`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const cards = response.json().data
    assert.equal(cards.length, 1)
    assert.equal(cards[0].id, internalCard.id)
  })

  test('returns 200 spanning descendant subfolders when scoped to folderId', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const canonicalNote = await actor.app.notesDataSource.createNote(
      { title: 'Inbox External', body: 'ext' },
      actor.userId,
    )
    const campaign = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Folder Drill Campaign', mode: 'campaign' },
      actor.userId,
    )
    const folder = await actor.app.notebooksDataSource.createFolder(
      { notebookId: campaign.id, name: 'Graph Rounds' },
      actor.userId,
    )
    const subfolder = await actor.app.notebooksDataSource.createFolder(
      { notebookId: campaign.id, parentId: folder.id, name: 'Weighted Graphs' },
      actor.userId,
    )
    const nestedNote = await actor.app.notesDataSource.createNote(
      {
        title: 'Nested Note',
        body: `Ref [[${canonicalNote.id}]]`,
        notebookId: campaign.id,
        folderId: subfolder.id,
      },
      actor.userId,
    )
    await actor.app.flashcardsDataSource.createFlashcard(
      { noteId: nestedNote.id, front: 'Q1', back: 'A1' },
      actor.userId,
    )
    await actor.app.flashcardsDataSource.createFlashcard(
      { noteId: canonicalNote.id, front: 'Q2', back: 'A2' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: `/flashcards/drill?folderId=${folder.id}&mode=scheduled`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.equal(response.json().data.length, 2)
  })

  test('returns 400 when mode or order query parameter is outside allowed enum', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: '/flashcards/drill?mode=invalid',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 400 when limit exceeds maximum of 200', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: '/flashcards/drill?limit=201',
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
      url: '/flashcards/drill',
    })

    // Assert
    assert.equal(response.statusCode, 401)
  })

  test('returns 404 when noteId does not exist', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: `/flashcards/drill?noteId=${randomUUIDv7()}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 404)
  })

  test('returns 404 when scoping drill to another users notebook or note', async (t) => {
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
      url: `/flashcards/drill?notebookId=${ownerNb.id}`,
      headers: { Authorization: `Bearer ${intruder.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 404)
  })
})
