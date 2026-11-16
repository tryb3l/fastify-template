'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { buildMarkdownNote } = require('../utils/markdown-note')
const {
  buildUploadForm,
  buildWavBuffer,
  fileExists,
  registerFileCleanup,
} = require('../utils/notes-files')
const { seedUser } = require('../utils/setup-user')

describe('Container-scoped CSV portability and media attachment streaming E2E workflow', () => {
  test('round-trips container-scoped CSV exports and imports with Note Links, verifies WAV uploads and 206/304 streaming, frees quota on delete, and unlinks disk blobs on Note delete', async (t) => {
    const actor = await seedUser(t, { env: { USER_STORAGE_QUOTA_BYTES: 350 } })
    const headers = { Authorization: `Bearer ${actor.accessToken}` }

    // 1. Create source Notebook/Folder, target Notebook/Folder, and an Inbox reference Note
    const inboxRefRes = await actor.app.inject({
      method: 'POST',
      url: '/notes',
      headers,
      payload: { title: 'Inbox Reference', body: 'Linked from exported note' },
    })
    assert.equal(inboxRefRes.statusCode, 201)
    const inboxRef = inboxRefRes.json().data

    const sourceNbRes = await actor.app.inject({
      method: 'POST',
      url: '/notebooks',
      headers,
      payload: { name: 'Source Notebook' },
    })
    const sourceNb = sourceNbRes.json().data
    const sourceFolderRes = await actor.app.inject({
      method: 'POST',
      url: `/notebooks/${sourceNb.id}/folders`,
      headers,
      payload: { name: 'Source Folder' },
    })
    const sourceFolder = sourceFolderRes.json().data

    const largeMarkdown = buildMarkdownNote({ minLength: 32_000 })
    await actor.app.inject({
      method: 'POST',
      url: '/notes',
      headers,
      payload: {
        title: 'Large Linked Debrief',
        body: `${largeMarkdown}\n\nSee [[${inboxRef.id}|Inbox Wiki]]`,
        tags: ['csv', 'md'],
        readiness: 'mastered',
        noteType: 'post_mortem',
        notebookId: sourceNb.id,
        folderId: sourceFolder.id,
      },
    })
    await actor.app.inject({
      method: 'POST',
      url: '/notes',
      headers,
      payload: {
        title: '=SUM(1,2)',
        body: '',
        tags: ['empty'],
        readiness: 'in_progress',
        notebookId: sourceNb.id,
        folderId: sourceFolder.id,
      },
    })

    // 2. Export scoped CSV from source Notebook/Folder (excluding Inbox Note and sanitizing formula prefix)
    const exportRes = await actor.app.inject({
      method: 'GET',
      url: `/files/export?notebookId=${sourceNb.id}&folderId=${sourceFolder.id}`,
      headers,
    })
    assert.equal(exportRes.statusCode, 200)
    assert.equal(exportRes.body.includes('Inbox Reference'), false)
    assert.ok(exportRes.body.includes('"\'=SUM(1,2)"'))

    // 3. Import the exported CSV into a destination Notebook/Folder
    const destNbRes = await actor.app.inject({
      method: 'POST',
      url: '/notebooks',
      headers,
      payload: { name: 'Destination Notebook' },
    })
    const destNb = destNbRes.json().data
    const destFolderRes = await actor.app.inject({
      method: 'POST',
      url: `/notebooks/${destNb.id}/folders`,
      headers,
      payload: { name: 'Imported Folder' },
    })
    const destFolder = destFolderRes.json().data

    const importForm = buildUploadForm(exportRes.body, {
      filename: 'roundtrip.csv',
      contentType: 'text/csv',
    })
    const importRes = await actor.app.inject({
      method: 'POST',
      url: `/files/import?notebookId=${destNb.id}&folderId=${destFolder.id}`,
      headers: {
        ...importForm.getHeaders(),
        ...headers,
      },
      payload: importForm,
    })
    assert.equal(importRes.statusCode, 201)
    const importedIds = importRes.json()
    assert.equal(importedIds.length, 2)

    const importedNotes = await Promise.all(
      importedIds.map(
        async (id) =>
          (await actor.app.inject({ method: 'GET', url: `/notes/${id}`, headers })).json().data,
      ),
    )
    const importedDebrief = importedNotes.find((n) => n.title === 'Large Linked Debrief')
    const importedFormula = importedNotes.find((n) => n.body === '')
    assert.ok(importedDebrief)
    assert.equal(importedDebrief.notebookId, destNb.id)
    assert.equal(importedDebrief.folderId, destFolder.id)
    assert.equal(importedDebrief.readiness, 'mastered')
    assert.equal(importedDebrief.noteType, 'post_mortem')
    assert.deepEqual(importedDebrief.links, [
      { targetId: inboxRef.id, relation: 'related', label: 'Inbox Wiki' },
    ])
    assert.ok(importedFormula)

    // 4. Upload magic-byte verified WAV audio (236 bytes) to importedDebrief and stream 206 byte range + 304 ETag
    const wavBytes = buildWavBuffer(192) // 236 bytes
    const wavForm = buildUploadForm(wavBytes, {
      filename: 'debrief-audio.wav',
      contentType: 'audio/wav',
    })
    const uploadWavRes = await actor.app.inject({
      method: 'POST',
      url: `/files/upload?noteId=${importedDebrief.id}`,
      headers: {
        ...wavForm.getHeaders(),
        ...headers,
      },
      payload: wavForm,
    })
    assert.equal(uploadWavRes.statusCode, 201)
    const wavFile = uploadWavRes.json().files[0]
    const wavDiskPath = registerFileCleanup(
      t,
      wavFile.fileId,
      wavFile.originalFilename,
      actor.app.notesFileManager.uploadDir,
    )
    assert.equal(await fileExists(wavDiskPath), true)

    const rangeRes = await actor.app.inject({
      method: 'GET',
      url: `/files/${wavFile.fileId}?noteId=${importedDebrief.id}`,
      headers: {
        ...headers,
        Range: 'bytes=0-11',
      },
    })
    assert.equal(rangeRes.statusCode, 206)
    assert.equal(rangeRes.headers['content-range'], `bytes 0-11/${wavBytes.length}`)
    assert.equal(rangeRes.rawPayload.subarray(0, 4).toString('ascii'), 'RIFF')
    const etag = rangeRes.headers['etag']

    const cachedRes = await actor.app.inject({
      method: 'GET',
      url: `/files/${wavFile.fileId}?noteId=${importedDebrief.id}`,
      headers: {
        ...headers,
        'if-none-match': etag,
      },
    })
    assert.equal(cachedRes.statusCode, 304)

    // 5. Quota enforcement (236 + 150 > 350 -> 413), then deleting wavFile frees quota so second upload succeeds
    const overQuotaForm = buildUploadForm(Buffer.alloc(150, 'q'), {
      filename: 'quota-check.txt',
      contentType: 'text/plain',
    })
    const overQuotaRes = await actor.app.inject({
      method: 'POST',
      url: `/files/upload?noteId=${importedDebrief.id}`,
      headers: {
        ...overQuotaForm.getHeaders(),
        ...headers,
      },
      payload: overQuotaForm,
    })
    assert.equal(overQuotaRes.statusCode, 413)

    const deleteWavRes = await actor.app.inject({
      method: 'DELETE',
      url: `/files/${wavFile.fileId}?noteId=${importedDebrief.id}`,
      headers,
    })
    assert.equal(deleteWavRes.statusCode, 204)
    assert.equal(await fileExists(wavDiskPath), false)

    const freedQuotaForm = buildUploadForm(Buffer.alloc(150, 'q'), {
      filename: 'cleanup-on-note-delete.txt',
      contentType: 'text/plain',
    })
    const secondUploadRes = await actor.app.inject({
      method: 'POST',
      url: `/files/upload?noteId=${importedDebrief.id}`,
      headers: {
        ...freedQuotaForm.getHeaders(),
        ...headers,
      },
      payload: freedQuotaForm,
    })
    assert.equal(secondUploadRes.statusCode, 201)
    const secondFile = secondUploadRes.json().files[0]
    const secondDiskPath = registerFileCleanup(
      t,
      secondFile.fileId,
      secondFile.originalFilename,
      actor.app.notesFileManager.uploadDir,
    )
    assert.equal(await fileExists(secondDiskPath), true)

    // 6. Deleting the parent Note unlinks remaining physical disk blobs automatically
    const latestDebrief = (
      await actor.app.inject({
        method: 'GET',
        url: `/notes/${importedDebrief.id}`,
        headers,
      })
    ).json().data

    const deleteNoteRes = await actor.app.inject({
      method: 'DELETE',
      url: `/notes/${importedDebrief.id}?expectedRevision=${latestDebrief.revision}`,
      headers,
    })
    assert.equal(deleteNoteRes.statusCode, 204)
    assert.equal(await fileExists(secondDiskPath), false)
  })
})
