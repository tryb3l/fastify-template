'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { seedUser } = require('../utils/setup-user')

describe('Workspace hierarchy and poly-hierarchical knowledge graph E2E workflow', () => {
  test('manages 5-level Folder hierarchy, Inbox/Notebook/Folder tree counts, Markdown and explicit Note Links, Backlinks, delete link cleanup, and Mind Map traversal', async (t) => {
    const actor = await seedUser(t)
    const headers = { Authorization: `Bearer ${actor.accessToken}` }

    // 1. Create Notebook and 5-level Folder chain
    const nbRes = await actor.app.inject({
      method: 'POST',
      url: '/notebooks',
      headers,
      payload: { name: 'Systems Architecture', description: 'Canonical knowledge base' },
    })
    assert.equal(nbRes.statusCode, 201)
    const notebook = nbRes.json().data

    const folderIds = []
    let parentId = null
    for (let depth = 1; depth <= 5; depth += 1) {
      const fldRes = await actor.app.inject({
        method: 'POST',
        url: `/notebooks/${notebook.id}/folders`,
        headers,
        payload: { name: `Level ${depth}`, parentId },
      })
      assert.equal(fldRes.statusCode, 201)
      parentId = fldRes.json().data.id
      folderIds.push(parentId)
    }

    // 2. Place Notes across Inbox, Notebook root, and depth-5 Folder with inline & explicit Note Links
    const noteARes = await actor.app.inject({
      method: 'POST',
      url: '/notes',
      headers,
      payload: {
        title: 'Fastify Core',
        body: 'Inbox root concept',
        tags: ['fastify'],
      },
    })
    assert.equal(noteARes.statusCode, 201)
    const noteA = noteARes.json().data

    const noteBRes = await actor.app.inject({
      method: 'POST',
      url: '/notes',
      headers,
      payload: {
        title: 'Encapsulation',
        body: `Builds on [[${noteA.id}|Fastify Core Wiki]]`,
        notebookId: notebook.id,
        tags: ['plugins'],
      },
    })
    assert.equal(noteBRes.statusCode, 201)
    const noteB = noteBRes.json().data
    assert.deepEqual(noteB.links, [
      { targetId: noteA.id, relation: 'related', label: 'Fastify Core Wiki' },
    ])

    const noteCRes = await actor.app.inject({
      method: 'POST',
      url: '/notes',
      headers,
      payload: {
        title: 'Autohooks Pattern',
        body: `See [[${noteB.id}]] and [Core](note://${noteA.id})`,
        notebookId: notebook.id,
        folderId: folderIds[4],
        links: [{ targetId: noteB.id, relation: 'parent', label: 'Primary Parent' }],
      },
    })
    assert.equal(noteCRes.statusCode, 201)
    const noteC = noteCRes.json().data
    assert.equal(noteC.links.length, 2)

    // 3. Verify GET /notebooks/tree & GET /notebooks/:id/tree counts across Inbox, root, and leaf Folder
    const workspaceTreeRes = await actor.app.inject({
      method: 'GET',
      url: '/notebooks/tree',
      headers,
    })
    assert.equal(workspaceTreeRes.statusCode, 200)
    const workspaceTree = workspaceTreeRes.json().data
    assert.equal(workspaceTree.inboxNoteCount, 1)
    assert.equal(workspaceTree.notebooks.length, 1)
    assert.equal(workspaceTree.notebooks[0].rootNoteCount, 1)
    assert.equal(workspaceTree.notebooks[0].totalNoteCount, 2)

    const nbTreeRes = await actor.app.inject({
      method: 'GET',
      url: `/notebooks/${notebook.id}/tree`,
      headers,
    })
    assert.equal(nbTreeRes.statusCode, 200)
    let leafFolder = nbTreeRes.json().data.folders[0]
    while (leafFolder.children.length > 0) {
      leafFolder = leafFolder.children[0]
    }
    assert.equal(leafFolder.id, folderIds[4])
    assert.equal(leafFolder.noteCount, 1)

    // 4. Verify Backlinks on Note A and Mind Map $graphLookup traversal from Note C -> B -> A
    const backlinksRes = await actor.app.inject({
      method: 'GET',
      url: `/notes/${noteA.id}/backlinks`,
      headers,
    })
    assert.equal(backlinksRes.statusCode, 200)
    assert.deepEqual(
      new Set(backlinksRes.json().data.map((b) => b.sourceId)),
      new Set([noteB.id, noteC.id]),
    )

    const graphRes = await actor.app.inject({
      method: 'GET',
      url: `/notes/graph?rootNoteId=${noteC.id}&maxDepth=3`,
      headers,
    })
    assert.equal(graphRes.statusCode, 200)
    const graph = graphRes.json().data
    assert.equal(graph.nodes.length, 3)
    assert.equal(graph.edges.length, 3)

    // 5. Delete Note A and confirm incoming links on Note B and Note C are automatically pulled
    const deleteARes = await actor.app.inject({
      method: 'DELETE',
      url: `/notes/${noteA.id}?expectedRevision=${noteA.revision}`,
      headers,
    })
    assert.equal(deleteARes.statusCode, 204)

    const refreshedCRes = await actor.app.inject({
      method: 'GET',
      url: `/notes/${noteC.id}`,
      headers,
    })
    assert.equal(refreshedCRes.statusCode, 200)
    assert.deepEqual(refreshedCRes.json().data.links, [
      { targetId: noteB.id, relation: 'parent', label: 'Primary Parent' },
    ])

    // 6. Move Note C to Inbox and delete the now-empty leaf Folder
    const unfileCRes = await actor.app.inject({
      method: 'PUT',
      url: `/notes/${noteC.id}`,
      headers,
      payload: {
        notebookId: null,
        body: 'Inline links removed',
        links: [],
        expectedRevision: refreshedCRes.json().data.revision,
      },
    })
    assert.equal(unfileCRes.statusCode, 200)
    assert.equal(unfileCRes.json().data.notebookId, null)
    assert.equal(unfileCRes.json().data.folderId, null)
    assert.deepEqual(unfileCRes.json().data.links, [])

    const deleteLeafFolderRes = await actor.app.inject({
      method: 'DELETE',
      url: `/notebooks/folders/${folderIds[4]}`,
      headers,
    })
    assert.equal(deleteLeafFolderRes.statusCode, 204)
  })
})
