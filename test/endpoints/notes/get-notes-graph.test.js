'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUIDv7 } = require('node:crypto')
const { seedUser } = require('../../utils/setup-user')

describe('GET /notes/graph', () => {
  test('returns 200 with Mind Map nodes, edges, and poly-hierarchical traversal omitting body', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const noteA = await actor.app.notesDataSource.createNote(
      { title: 'Fastify Core', body: 'Root concept' },
      actor.userId,
    )
    const noteB = await actor.app.notesDataSource.createNote(
      { title: 'Encapsulation', body: `Builds on [[${noteA.id}|Fastify Core Wiki]]` },
      actor.userId,
    )
    const noteC = await actor.app.notesDataSource.createNote(
      {
        title: 'Autohooks Pattern',
        body: `See [[${noteB.id}]] and [Core](note://${noteA.id})`,
        links: [{ targetId: noteB.id, relation: 'parent', label: 'Primary Parent' }],
      },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: `/notes/graph?rootNoteId=${noteC.id}&maxDepth=3`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const graph = response.json().data
    assert.equal(graph.nodes.length, 3)
    assert.equal(graph.edges.length, 3)
    for (const node of graph.nodes) {
      assert.equal(Object.hasOwn(node, 'body'), false)
      assert.equal(node.isExternal, false)
    }
    const parentEdge = graph.edges.find((e) => e.sourceId === noteC.id && e.targetId === noteB.id)
    assert.deepEqual(parentEdge, {
      sourceId: noteC.id,
      targetId: noteB.id,
      relation: 'parent',
      label: 'Primary Parent',
    })
  })

  test('returns 200 expanding 1-hop external Note Links with isExternal and homeNotebookId when scoped to notebookId', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const canonicalNb = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Distributed Systems', mode: 'notebook' },
      actor.userId,
    )
    const externalNote = await actor.app.notesDataSource.createNote(
      { title: 'Raft Consensus', body: 'Log replication', notebookId: canonicalNb.id },
      actor.userId,
    )
    const campaign = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Interview Prep', mode: 'campaign' },
      actor.userId,
    )
    const internalNote = await actor.app.notesDataSource.createNote(
      {
        title: 'Rate Limiter',
        body: `Uses [[${externalNote.id}|Raft]]`,
        notebookId: campaign.id,
      },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: `/notes/graph?notebookId=${campaign.id}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const graph = response.json().data
    assert.equal(graph.nodes.length, 2)
    assert.equal(graph.edges.length, 1)

    const externalNode = graph.nodes.find((n) => n.id === externalNote.id)
    const internalNode = graph.nodes.find((n) => n.id === internalNote.id)
    assert.equal(externalNode.isExternal, true)
    assert.equal(externalNode.homeNotebookId, canonicalNb.id)
    assert.equal(internalNode.isExternal, false)
    assert.equal(internalNode.homeNotebookId, campaign.id)
  })

  test('returns 200 excluding 1-hop external nodes when includeExternal=false', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const canonicalNb = await actor.app.notebooksDataSource.createNotebook(
      { name: 'KB' },
      actor.userId,
    )
    const externalNote = await actor.app.notesDataSource.createNote(
      { title: 'External Note', body: 'outside', notebookId: canonicalNb.id },
      actor.userId,
    )
    const campaign = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Campaign', mode: 'campaign' },
      actor.userId,
    )
    const internalNote = await actor.app.notesDataSource.createNote(
      { title: 'Internal Note', body: `Ref [[${externalNote.id}]]`, notebookId: campaign.id },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: `/notes/graph?notebookId=${campaign.id}&includeExternal=false`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const graph = response.json().data
    assert.equal(graph.nodes.length, 1)
    assert.equal(graph.nodes[0].id, internalNote.id)
    assert.equal(graph.edges.length, 0)
  })

  test('returns 200 scoping Mind Map traversal to notebookId when rootNoteId is supplied', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const notebook = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Scoped Graph NB' },
      actor.userId,
    )
    const externalNote = await actor.app.notesDataSource.createNote(
      { title: 'Inbox External', body: 'outside' },
      actor.userId,
    )
    const rootNote = await actor.app.notesDataSource.createNote(
      {
        title: 'Scoped Root',
        body: `Links to [[${externalNote.id}|Inbox Ref]]`,
        notebookId: notebook.id,
      },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: `/notes/graph?rootNoteId=${rootNote.id}&notebookId=${notebook.id}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const graph = response.json().data
    assert.equal(graph.nodes.length, 1)
    assert.equal(graph.nodes[0].id, rootNote.id)
    assert.equal(graph.edges.length, 0)
  })

  test('returns 200 spanning descendant folders when scoped by folderId', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const externalNote = await actor.app.notesDataSource.createNote(
      { title: 'Inbox External', body: 'inbox' },
      actor.userId,
    )
    const notebook = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Tree Graph NB' },
      actor.userId,
    )
    const parentFolder = await actor.app.notebooksDataSource.createFolder(
      { notebookId: notebook.id, name: 'Parent Folder' },
      actor.userId,
    )
    const childFolder = await actor.app.notebooksDataSource.createFolder(
      { notebookId: notebook.id, parentId: parentFolder.id, name: 'Child Folder' },
      actor.userId,
    )
    await actor.app.notesDataSource.createNote(
      {
        title: 'Nested Note',
        body: `Ref [[${externalNote.id}]]`,
        notebookId: notebook.id,
        folderId: childFolder.id,
      },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: `/notes/graph?folderId=${parentFolder.id}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const graph = response.json().data
    assert.equal(graph.nodes.length, 2)
    assert.equal(graph.edges.length, 1)
  })

  test('returns 400 when maxDepth exceeds maximum of 5', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: '/notes/graph?maxDepth=6',
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
      url: '/notes/graph',
    })

    // Assert
    assert.equal(response.statusCode, 401)
  })

  test('returns 404 when rootNoteId belongs to another user', async (t) => {
    // Arrange
    const owner = await seedUser(t)
    const intruder = await seedUser(t, { app: owner.app })
    const ownerNote = await owner.app.notesDataSource.createNote(
      { title: 'Private Root', body: 'secret' },
      owner.userId,
    )

    // Act
    const response = await intruder.app.inject({
      method: 'GET',
      url: `/notes/graph?rootNoteId=${ownerNote.id}`,
      headers: { Authorization: `Bearer ${intruder.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 404)
  })

  test('returns 404 when rootNoteId does not exist', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: `/notes/graph?rootNoteId=${randomUUIDv7()}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 404)
  })
})
