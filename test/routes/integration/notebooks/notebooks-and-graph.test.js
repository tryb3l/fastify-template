'use strict'

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs/promises')
const path = require('node:path')
const FormData = require('form-data')
const { setup } = require('../../../utils/setup-user')

async function createNotebook(
  app,
  accessToken,
  payload = { name: 'Engineering', description: 'Tech notes' },
) {
  const res = await app.inject({
    method: 'POST',
    url: '/notebooks',
    headers: { Authorization: `Bearer ${accessToken}` },
    payload,
  })
  assert.strictEqual(res.statusCode, 201, res.payload)
  return res.json().data
}

async function createFolder(app, accessToken, notebookId, payload) {
  const res = await app.inject({
    method: 'POST',
    url: `/notebooks/${notebookId}/folders`,
    headers: { Authorization: `Bearer ${accessToken}` },
    payload,
  })
  return res
}

async function createNote(app, accessToken, payload) {
  const res = await app.inject({
    method: 'POST',
    url: '/notes',
    headers: { Authorization: `Bearer ${accessToken}` },
    payload,
  })
  return res
}

test('Notebooks & Folders - Enforces max depth 5, prevents cycles, and blocks cross-notebook folder moves', async (t) => {
  const { app, accessToken } = await setup(t, 'user')
  const notebookA = await createNotebook(app, accessToken, { name: 'Notebook A' })
  const notebookB = await createNotebook(app, accessToken, { name: 'Notebook B' })

  const folderIds = []
  let parentId = null

  for (let depth = 1; depth <= 5; depth += 1) {
    const res = await createFolder(app, accessToken, notebookA.id, {
      name: `Level ${depth}`,
      parentId,
    })
    assert.strictEqual(res.statusCode, 201, `Depth ${depth} should succeed: ${res.payload}`)
    const folder = res.json().data
    folderIds.push(folder.id)
    parentId = folder.id
  }

  // Depth 6 must be rejected with 400
  const depth6Res = await createFolder(app, accessToken, notebookA.id, {
    name: 'Level 6 Exceeded',
    parentId,
  })
  assert.strictEqual(depth6Res.statusCode, 400)
  assert.match(depth6Res.json().message, /maximum depth of 5/)

  // Cycle guard: cannot move Level 1 folder under its own descendant (Level 3)
  const cycleRes = await app.inject({
    method: 'PUT',
    url: `/notebooks/folders/${folderIds[0]}`,
    headers: { Authorization: `Bearer ${accessToken}` },
    payload: { parentId: folderIds[2] },
  })
  assert.strictEqual(cycleRes.statusCode, 400)
  assert.match(cycleRes.json().message, /descendant/)

  // Cross-notebook move guard: cannot move folder to Notebook B
  const crossNotebookRes = await app.inject({
    method: 'PUT',
    url: `/notebooks/folders/${folderIds[0]}`,
    headers: { Authorization: `Bearer ${accessToken}` },
    payload: { notebookId: notebookB.id },
  })
  assert.strictEqual(crossNotebookRes.statusCode, 400)
  assert.match(crossNotebookRes.json().message, /different notebooks/)
})

test('Notebooks & Folders - Workspace tree counts Inbox, Notebook root, and nested Folder notes accurately and guards non-empty deletes', async (t) => {
  const { app, accessToken } = await setup(t, 'user')
  const notebook = await createNotebook(app, accessToken, { name: 'Architecture' })
  const folderRes = await createFolder(app, accessToken, notebook.id, { name: 'ADRs' })
  assert.strictEqual(folderRes.statusCode, 201)
  const folder = folderRes.json().data

  // 1. Inbox note
  const inboxNoteRes = await createNote(app, accessToken, {
    title: 'Quick Inbox Thought',
    body: 'Unfiled note',
  })
  assert.strictEqual(inboxNoteRes.statusCode, 201)
  const inboxNote = inboxNoteRes.json().data
  assert.strictEqual(inboxNote.notebookId, null)
  assert.strictEqual(inboxNote.folderId, null)

  // 2. Notebook root note (notebookId set, folderId null)
  const rootNoteRes = await createNote(app, accessToken, {
    title: 'Overview Note',
    body: 'At notebook root',
    notebookId: notebook.id,
  })
  assert.strictEqual(rootNoteRes.statusCode, 201)
  const rootNote = rootNoteRes.json().data
  assert.strictEqual(rootNote.notebookId, notebook.id)
  assert.strictEqual(rootNote.folderId, null)

  // 3. Folder note
  const folderNoteRes = await createNote(app, accessToken, {
    title: 'ADR 0001',
    body: 'Inside ADRs folder',
    notebookId: notebook.id,
    folderId: folder.id,
  })
  assert.strictEqual(folderNoteRes.statusCode, 201)
  const folderNote = folderNoteRes.json().data
  assert.strictEqual(folderNote.notebookId, notebook.id)
  assert.strictEqual(folderNote.folderId, folder.id)

  // Verify workspace tree counts
  const treeRes = await app.inject({
    method: 'GET',
    url: '/notebooks/tree',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  assert.strictEqual(treeRes.statusCode, 200)
  const workspaceTree = treeRes.json().data
  assert.strictEqual(workspaceTree.inboxNoteCount, 1)
  assert.strictEqual(workspaceTree.notebooks.length, 1)
  assert.strictEqual(workspaceTree.notebooks[0].rootNoteCount, 1)
  assert.strictEqual(workspaceTree.notebooks[0].totalNoteCount, 2)
  assert.strictEqual(workspaceTree.notebooks[0].folders[0].noteCount, 1)

  // Non-empty delete guards (409 Conflict)
  const deleteNonEmptyFolder = await app.inject({
    method: 'DELETE',
    url: `/notebooks/folders/${folder.id}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  assert.strictEqual(deleteNonEmptyFolder.statusCode, 409)
  assert.strictEqual(deleteNonEmptyFolder.json().code, 'FOLDER_NOT_EMPTY')

  const deleteNonEmptyNotebook = await app.inject({
    method: 'DELETE',
    url: `/notebooks/${notebook.id}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  assert.strictEqual(deleteNonEmptyNotebook.statusCode, 409)
  assert.strictEqual(deleteNonEmptyNotebook.json().code, 'NOTEBOOK_NOT_EMPTY')

  // Move folderNote to Inbox via revision-guarded PUT, then delete empty folder
  const moveNoteRes = await app.inject({
    method: 'PUT',
    url: `/notes/${folderNote.id}`,
    headers: { Authorization: `Bearer ${accessToken}` },
    payload: {
      notebookId: null,
      expectedRevision: folderNote.revision,
    },
  })
  assert.strictEqual(moveNoteRes.statusCode, 200)
  assert.strictEqual(moveNoteRes.json().data.notebookId, null)
  assert.strictEqual(moveNoteRes.json().data.folderId, null)

  const deleteEmptyFolder = await app.inject({
    method: 'DELETE',
    url: `/notebooks/folders/${folder.id}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  assert.strictEqual(deleteEmptyFolder.statusCode, 204)
})

test('Notebooks & Folders - Enforces container invariants and blocks cross-tenant IDOR', async (t) => {
  const owner = await setup(t, 'user')
  const intruder = await setup(t, 'user')

  const ownerNotebook = await createNotebook(owner.app, owner.accessToken, { name: 'Private NB' })
  const otherOwnerNotebook = await createNotebook(owner.app, owner.accessToken, {
    name: 'Second NB',
  })
  const ownerFolderRes = await createFolder(owner.app, owner.accessToken, ownerNotebook.id, {
    name: 'Private Folder',
  })
  const ownerFolder = ownerFolderRes.json().data

  // Cannot assign folderId without notebookId
  const orphanFolderNote = await createNote(owner.app, owner.accessToken, {
    title: 'Invalid placement',
    folderId: ownerFolder.id,
  })
  assert.strictEqual(orphanFolderNote.statusCode, 400)

  // Cannot assign folderId belonging to a different notebook
  const mismatchedFolderNote = await createNote(owner.app, owner.accessToken, {
    title: 'Mismatched container',
    notebookId: otherOwnerNotebook.id,
    folderId: ownerFolder.id,
  })
  assert.strictEqual(mismatchedFolderNote.statusCode, 400)

  // Intruder cannot read, delete, or file a note into owner's notebook
  const intruderReadNb = await intruder.app.inject({
    method: 'GET',
    url: `/notebooks/${ownerNotebook.id}`,
    headers: { Authorization: `Bearer ${intruder.accessToken}` },
  })
  assert.strictEqual(intruderReadNb.statusCode, 404)

  const intruderNoteInOwnerNb = await createNote(intruder.app, intruder.accessToken, {
    title: 'IDOR attempt',
    notebookId: ownerNotebook.id,
  })
  assert.strictEqual(intruderNoteInOwnerNb.statusCode, 404)
})

test('Poly-Hierarchical Note Links, Backlinks & Mind-Map $graphLookup - Dual link capture, traversal, and delete cleanup', async (t) => {
  const { app, accessToken } = await setup(t, 'user')

  // Create Concept A and Concept B
  const noteARes = await createNote(app, accessToken, {
    title: 'Fastify Core',
    body: 'Root architecture concept',
    tags: ['fastify'],
  })
  const noteA = noteARes.json().data

  const noteBRes = await createNote(app, accessToken, {
    title: 'Encapsulation',
    body: `Builds on [[${noteA.id}|Fastify Core Wiki]]`,
    tags: ['plugins'],
  })
  const noteB = noteBRes.json().data

  // Verify Note B automatically extracted the wiki-link to Note A as 'related'
  assert.deepStrictEqual(noteB.links, [
    {
      targetId: noteA.id,
      relation: 'related',
      label: 'Fastify Core Wiki',
    },
  ])

  // Create Note C with explicit 'parent' link to Note B AND Markdown URI link to Note A
  // Also include Note B in both explicit ('parent') and Markdown ('related') to verify explicit relation wins
  const noteCRes = await createNote(app, accessToken, {
    title: 'Autohooks Pattern',
    body: `See [[${noteB.id}]] and [Core](note://${noteA.id})`,
    links: [{ targetId: noteB.id, relation: 'parent', label: 'Primary Parent' }],
  })
  assert.strictEqual(noteCRes.statusCode, 201)
  const noteC = noteCRes.json().data

  assert.strictEqual(noteC.links.length, 2)
  const linkToB = noteC.links.find((l) => l.targetId === noteB.id)
  const linkToA = noteC.links.find((l) => l.targetId === noteA.id)
  assert.deepStrictEqual(linkToB, {
    targetId: noteB.id,
    relation: 'parent',
    label: 'Primary Parent',
  })
  assert.deepStrictEqual(linkToA, {
    targetId: noteA.id,
    relation: 'related',
    label: 'Core',
  })

  // Check Backlinks for Note A (should include both Note B and Note C)
  const backlinksRes = await app.inject({
    method: 'GET',
    url: `/notes/${noteA.id}/backlinks`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  assert.strictEqual(backlinksRes.statusCode, 200)
  const backlinks = backlinksRes.json().data
  assert.strictEqual(backlinks.length, 2)
  assert.deepStrictEqual(new Set(backlinks.map((b) => b.sourceId)), new Set([noteB.id, noteC.id]))

  // Query Mind-Map Subgraph starting from Note C with maxDepth=3 ($graphLookup traverses C -> B -> A)
  const graphRes = await app.inject({
    method: 'GET',
    url: `/notes/graph?rootNoteId=${noteC.id}&maxDepth=3`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  assert.strictEqual(graphRes.statusCode, 200)
  const graph = graphRes.json().data
  assert.strictEqual(graph.nodes.length, 3)
  assert.strictEqual(graph.edges.length, 3)
  assert.strictEqual(
    Object.hasOwn(graph.nodes[0], 'body'),
    false,
    'Graph nodes must omit heavy markdown body',
  )

  // Delete Note A and verify incoming links on Note B and Note C are automatically $pulled
  const deleteARes = await app.inject({
    method: 'DELETE',
    url: `/notes/${noteA.id}?expectedRevision=${noteA.revision}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  assert.strictEqual(deleteARes.statusCode, 204)

  const refreshedCRes = await app.inject({
    method: 'GET',
    url: `/notes/${noteC.id}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  assert.strictEqual(refreshedCRes.statusCode, 200)
  assert.deepStrictEqual(refreshedCRes.json().data.links, [
    {
      targetId: noteB.id,
      relation: 'parent',
      label: 'Primary Parent',
    },
  ])

  // Create Note D with an inline [[uuid]] link, then update body to remove it (omitting links) and verify links becomes []
  const noteDRes = await createNote(app, accessToken, {
    title: 'Note D with inline wiki-link',
    body: `See [[${noteB.id}]]`,
  })
  assert.strictEqual(noteDRes.statusCode, 201)
  const noteD = noteDRes.json().data
  assert.deepStrictEqual(noteD.links, [
    {
      targetId: noteB.id,
      relation: 'related',
    },
  ])

  const updateNoteDRes = await app.inject({
    method: 'PUT',
    url: `/notes/${noteD.id}`,
    headers: { Authorization: `Bearer ${accessToken}` },
    payload: {
      body: 'Removed link',
      expectedRevision: noteD.revision,
    },
  })
  assert.strictEqual(updateNoteDRes.statusCode, 200)
  assert.deepStrictEqual(updateNoteDRes.json().data.links, [])
})

test('Attachment Lifecycle (#4) & CSV Container Scoping (#5) - Cleans up disk blobs on deleteNote and scopes CSV import/export to Notebook/Folder', async (t) => {
  const { app, accessToken } = await setup(t, 'user')
  const notebook = await createNotebook(app, accessToken, { name: 'Exports & Attachments' })
  const folderRes = await createFolder(app, accessToken, notebook.id, { name: 'Reports' })
  const folder = folderRes.json().data

  // Create an Inbox note that links to Scoped Import 1, plus a CSV import row linking to that Inbox note
  const inboxTargetRes = await createNote(app, accessToken, {
    title: 'Unrelated Inbox Note',
    body: 'Should be excluded from folder-scoped export and notebook-scoped graph',
  })
  const inboxTarget = inboxTargetRes.json().data

  // 1. Import CSV directly into the Notebook + Folder (including an inline [[uuid|Label]] wiki-link)
  const csvContent = [
    'title,body,tags',
    `Scoped Import 1,"Body 1 linking to [[${inboxTarget.id}|Inbox Ref]]","[""csv""]"`,
    'Scoped Import 2,Body 2,"[""csv""]"',
  ].join('\n')
  const importForm = new FormData()
  importForm.append('file', Buffer.from(csvContent), {
    filename: 'scoped.csv',
    contentType: 'text/csv',
  })

  const importRes = await app.inject({
    method: 'POST',
    url: `/files/import?notebookId=${notebook.id}&folderId=${folder.id}`,
    headers: {
      ...importForm.getHeaders(),
      Authorization: `Bearer ${accessToken}`,
    },
    payload: importForm,
  })
  assert.strictEqual(importRes.statusCode, 201)
  const importedIds = importRes.json()
  assert.strictEqual(importedIds.length, 2)

  // Verify CSV import extracted the [[uuid|Inbox Ref]] link on Scoped Import 1
  const importedNote1Res = await app.inject({
    method: 'GET',
    url: `/notes/${importedIds[0]}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  assert.strictEqual(importedNote1Res.statusCode, 200)
  assert.deepStrictEqual(importedNote1Res.json().data.links, [
    {
      targetId: inboxTarget.id,
      relation: 'related',
      label: 'Inbox Ref',
    },
  ])

  // Verify GET /notes/graph with both rootNoteId and notebookId scopes traversal strictly to that notebook
  const scopedGraphRes = await app.inject({
    method: 'GET',
    url: `/notes/graph?rootNoteId=${importedIds[0]}&notebookId=${notebook.id}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  assert.strictEqual(scopedGraphRes.statusCode, 200)
  const scopedGraph = scopedGraphRes.json().data
  assert.strictEqual(scopedGraph.nodes.length, 1)
  assert.strictEqual(scopedGraph.nodes[0].id, importedIds[0])
  assert.strictEqual(scopedGraph.edges.length, 0)

  const exportRes = await app.inject({
    method: 'GET',
    url: `/files/export?notebookId=${notebook.id}&folderId=${folder.id}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  assert.strictEqual(exportRes.statusCode, 200)
  assert.ok(exportRes.body.includes('Scoped Import 1'))
  assert.ok(exportRes.body.includes('Scoped Import 2'))
  assert.strictEqual(exportRes.body.includes('Unrelated Inbox Note'), false)

  // 2. Upload an attachment to importedIds[0], then delete the note and verify disk blob is unlinked
  const uploadForm = new FormData()
  uploadForm.append('file', Buffer.from('attachment payload to clean up'), {
    filename: 'cleanup-check.txt',
    contentType: 'text/plain',
  })

  const uploadRes = await app.inject({
    method: 'POST',
    url: `/files/upload?noteId=${importedIds[0]}`,
    headers: {
      ...uploadForm.getHeaders(),
      Authorization: `Bearer ${accessToken}`,
    },
    payload: uploadForm,
  })
  assert.strictEqual(uploadRes.statusCode, 201)
  const uploadedFile = uploadRes.json().files[0]
  const diskPath = path.join(process.cwd(), 'uploads', `${uploadedFile.fileId}.txt`)

  const existsBeforeDelete = await fs
    .access(diskPath)
    .then(() => true)
    .catch(() => false)
  assert.strictEqual(existsBeforeDelete, true, 'Attachment blob must exist on disk after upload')

  const deleteNoteRes = await app.inject({
    method: 'DELETE',
    url: `/notes/${importedIds[0]}?expectedRevision=1`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  assert.strictEqual(deleteNoteRes.statusCode, 204)

  const existsAfterDelete = await fs
    .access(diskPath)
    .then(() => true)
    .catch(() => false)
  assert.strictEqual(
    existsAfterDelete,
    false,
    'Attachment blob must be unlinked when note is deleted',
  )
})
