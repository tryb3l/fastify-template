'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { setup } = require('../../../utils/setup-user')

async function createNotebook(app, accessToken, payload) {
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
  assert.strictEqual(res.statusCode, 201, res.payload)
  return res.json().data
}

async function createNote(app, accessToken, payload) {
  const res = await app.inject({
    method: 'POST',
    url: '/notes',
    headers: { Authorization: `Bearer ${accessToken}` },
    payload,
  })
  assert.strictEqual(res.statusCode, 201, res.payload)
  return res.json().data
}

test('Campaigns Lifecycle - Creates Campaign with interview/exam starter templates, filters by mode and status, and archives', async (t) => {
  const { app, accessToken } = await setup(t, 'user')

  const targetDate = '2026-12-15T09:00:00.000Z'
  const interviewCampaign = await createNotebook(app, accessToken, {
    name: 'Staff Backend Interview',
    description: 'Distributed systems & Node.js internals',
    mode: 'campaign',
    targetDate,
    starterTemplate: 'interview',
  })

  assert.strictEqual(interviewCampaign.mode, 'campaign')
  assert.strictEqual(interviewCampaign.status, 'active')
  assert.strictEqual(interviewCampaign.targetDate, targetDate)

  const foldersRes = await app.inject({
    method: 'GET',
    url: `/notebooks/${interviewCampaign.id}/folders`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  assert.strictEqual(foldersRes.statusCode, 200)
  const seededNames = foldersRes.json().data.map((f) => f.name)
  assert.deepStrictEqual(seededNames, [
    '01 - Screening & Recruiter',
    '02 - Technical & Coding',
    '03 - System Design & Architecture',
    '04 - Post-Mortems & Debriefs',
  ])

  const examCampaign = await createNotebook(app, accessToken, {
    name: 'AWS Solutions Architect Exam',
    mode: 'campaign',
    starterTemplate: 'exam',
  })
  const examFoldersRes = await app.inject({
    method: 'GET',
    url: `/notebooks/${examCampaign.id}/folders`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  assert.deepStrictEqual(
    examFoldersRes.json().data.map((f) => f.name),
    ['01 - Core Syllabus', '02 - Practice & Mock Problems', '03 - Post-Mortems & Weak Spots'],
  )

  const evergreenNotebook = await createNotebook(app, accessToken, {
    name: 'Core Computer Science',
  })
  assert.strictEqual(evergreenNotebook.mode, 'notebook')
  assert.strictEqual(evergreenNotebook.status, 'active')
  assert.strictEqual(evergreenNotebook.targetDate, null)

  // Filter GET /notebooks?mode=campaign&status=active
  const activeCampaignsRes = await app.inject({
    method: 'GET',
    url: '/notebooks?mode=campaign&status=active',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  assert.strictEqual(activeCampaignsRes.statusCode, 200)
  assert.strictEqual(activeCampaignsRes.json().data.length, 2)

  // Archive examCampaign via PUT /notebooks/:id
  const archiveRes = await app.inject({
    method: 'PUT',
    url: `/notebooks/${examCampaign.id}`,
    headers: { Authorization: `Bearer ${accessToken}` },
    payload: { status: 'archived' },
  })
  assert.strictEqual(archiveRes.statusCode, 200)
  assert.strictEqual(archiveRes.json().data.status, 'archived')

  // Verify custom starterFolders array on POST /notebooks
  const customCampaign = await createNotebook(app, accessToken, {
    name: 'Custom Stage Campaign',
    mode: 'campaign',
    starterFolders: ['Stage A', 'Stage B'],
  })
  const customFoldersRes = await app.inject({
    method: 'GET',
    url: `/notebooks/${customCampaign.id}/folders`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  assert.deepStrictEqual(
    customFoldersRes.json().data.map((f) => f.name),
    ['Stage A', 'Stage B'],
  )

  const archivedListRes = await app.inject({
    method: 'GET',
    url: '/notebooks?mode=campaign&status=archived',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  assert.strictEqual(archivedListRes.statusCode, 200)
  assert.strictEqual(archivedListRes.json().data.length, 1)
  assert.strictEqual(archivedListRes.json().data[0].id, examCampaign.id)
})

test('Readiness Rollups, Post-Mortem Exclusion, and 1-Hop External Link Expansion across Mind Maps and Trees', async (t) => {
  const { app, accessToken } = await setup(t, 'user')

  // 1. Canonical evergreen Notebook with 2 canonical notes
  const canonicalNb = await createNotebook(app, accessToken, {
    name: 'Distributed Systems KB',
    mode: 'notebook',
  })
  const canonicalMasteredNote = await createNote(app, accessToken, {
    title: 'Raft Consensus',
    body: 'Leader election and log replication',
    notebookId: canonicalNb.id,
    readiness: 'mastered',
  })
  const canonicalInProgressNote = await createNote(app, accessToken, {
    title: 'Consistent Hashing',
    body: 'Ring topology and virtual nodes',
    notebookId: canonicalNb.id,
    readiness: 'in_progress',
  })

  // 2. Interview Campaign with a System Design folder and a nested subfolder
  const campaign = await createNotebook(app, accessToken, {
    name: 'Cloudflare Interview Campaign',
    mode: 'campaign',
    targetDate: '2026-11-01T00:00:00.000Z',
  })
  const sysDesignFolder = await createFolder(app, accessToken, campaign.id, {
    name: 'System Design',
  })
  const deepDiveSubfolder = await createFolder(app, accessToken, campaign.id, {
    name: 'State & Consensus',
    parentId: sysDesignFolder.id,
  })

  // Note inside Campaign folder that links to BOTH canonical notes in Distributed Systems KB
  const campaignGuideNote = await createNote(app, accessToken, {
    title: 'Global Rate Limiter Prep',
    body: `Study [[${canonicalMasteredNote.id}|Raft]] and [[${canonicalInProgressNote.id}|Hashing]]`,
    notebookId: campaign.id,
    folderId: deepDiveSubfolder.id,
    readiness: 'to_review',
  })

  // Post-mortem note inside Campaign folder (must NOT dilute readiness score)
  const postMortemNote = await createNote(app, accessToken, {
    title: 'Round 1 Phone Screen Debrief',
    body: 'Need to review edge cases on token bucket',
    notebookId: campaign.id,
    folderId: sysDesignFolder.id,
    readiness: 'to_review',
    noteType: 'post_mortem',
  })
  assert.strictEqual(postMortemNote.noteType, 'post_mortem')
  assert.strictEqual(postMortemNote.readiness, 'to_review')

  // 3. Verify GET /notes filters by readiness and noteType
  const postMortemsListRes = await app.inject({
    method: 'GET',
    url: `/notes?notebookId=${campaign.id}&noteType=post_mortem`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  assert.strictEqual(postMortemsListRes.statusCode, 200)
  assert.strictEqual(postMortemsListRes.json().data.length, 1)
  assert.strictEqual(postMortemsListRes.json().data[0].id, postMortemNote.id)

  // 4. Verify GET /notes/graph?notebookId=<campaign.id> expands 1-hop external canonical notes
  const graphRes = await app.inject({
    method: 'GET',
    url: `/notes/graph?notebookId=${campaign.id}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  assert.strictEqual(graphRes.statusCode, 200, graphRes.payload)
  const graph = graphRes.json().data
  // 2 campaign notes + 2 1-hop external canonical notes = 4 nodes
  assert.strictEqual(graph.nodes.length, 4)
  assert.strictEqual(graph.edges.length, 2)

  const raftGraphNode = graph.nodes.find((n) => n.id === canonicalMasteredNote.id)
  assert.ok(raftGraphNode, '1-hop external canonical note must be included in Campaign Mind Map')
  assert.strictEqual(raftGraphNode.isExternal, true)
  assert.strictEqual(raftGraphNode.homeNotebookId, canonicalNb.id)
  assert.strictEqual(raftGraphNode.readiness, 'mastered')

  const internalGraphNode = graph.nodes.find((n) => n.id === campaignGuideNote.id)
  assert.strictEqual(internalGraphNode.isExternal, false)
  assert.strictEqual(internalGraphNode.homeNotebookId, campaign.id)

  // Verify includeExternal=false excludes 1-hop external notes
  const strictGraphRes = await app.inject({
    method: 'GET',
    url: `/notes/graph?notebookId=${campaign.id}&includeExternal=false`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  assert.strictEqual(strictGraphRes.statusCode, 200)
  assert.strictEqual(strictGraphRes.json().data.nodes.length, 2)

  // Verify folder-scoped GET /notes/graph?folderId=<sysDesignFolder.id> includes descendant subfolder notes + 1-hop external links
  const folderGraphRes = await app.inject({
    method: 'GET',
    url: `/notes/graph?folderId=${sysDesignFolder.id}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  assert.strictEqual(folderGraphRes.statusCode, 200)
  assert.strictEqual(folderGraphRes.json().data.nodes.length, 4)

  // 5. Verify GET /notebooks/:id/tree computes Readiness across internal + 1-hop external notes, excluding post_mortem
  // Non-post-mortem notes in scope for Campaign (and sysDesignFolder / deepDiveSubfolder):
  // - campaignGuideNote: 'to_review' (0.0)
  // - canonicalMasteredNote (1-hop external): 'mastered' (1.0)
  // - canonicalInProgressNote (1-hop external): 'in_progress' (0.5)
  // Total = 3 notes, weighted sum = 1.5 -> scorePercent = Math.round((1.5 / 3) * 100) = 50 -> blocks = 5
  const treeRes = await app.inject({
    method: 'GET',
    url: `/notebooks/${campaign.id}/tree`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  assert.strictEqual(treeRes.statusCode, 200, treeRes.payload)
  const campaignTree = treeRes.json().data
  assert.strictEqual(campaignTree.mode, 'campaign')
  assert.deepStrictEqual(campaignTree.readiness, {
    toReviewCount: 1,
    inProgressCount: 1,
    masteredCount: 1,
    totalCount: 3,
    scorePercent: 50,
    blocks: 5,
  })

  // Parent folder (sysDesignFolder) rolls up its descendant subfolder (deepDiveSubfolder) + 1-hop external links
  // while ignoring the post_mortem note inside sysDesignFolder!
  const rootFolderNode = campaignTree.folders[0]
  assert.strictEqual(rootFolderNode.id, sysDesignFolder.id)
  assert.deepStrictEqual(rootFolderNode.readiness, {
    toReviewCount: 1,
    inProgressCount: 1,
    masteredCount: 1,
    totalCount: 3,
    scorePercent: 50,
    blocks: 5,
  })

  // Promote campaignGuideNote to 'mastered' via PUT /notes/:id and verify readiness jumps to 83% (8 blocks)
  const promoteRes = await app.inject({
    method: 'PUT',
    url: `/notes/${campaignGuideNote.id}`,
    headers: { Authorization: `Bearer ${accessToken}` },
    payload: {
      readiness: 'mastered',
      expectedRevision: campaignGuideNote.revision,
    },
  })
  assert.strictEqual(promoteRes.statusCode, 200)
  assert.strictEqual(promoteRes.json().data.readiness, 'mastered')
  assert.strictEqual(promoteRes.json().data.revision, campaignGuideNote.revision + 1)

  const updatedTreeRes = await app.inject({
    method: 'GET',
    url: '/notebooks/tree',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  assert.strictEqual(updatedTreeRes.statusCode, 200)
  const updatedCampaignNode = updatedTreeRes
    .json()
    .data.notebooks.find((nb) => nb.id === campaign.id)
  assert.deepStrictEqual(updatedCampaignNode.readiness, {
    toReviewCount: 0,
    inProgressCount: 1,
    masteredCount: 2,
    totalCount: 3,
    scorePercent: 83,
    blocks: 8,
  })
})
