'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { createNote } = require('../utils/note-creator')
const { buildUploadForm, fileExists, registerFileCleanup } = require('../utils/notes-files')

describe('Note Attachments CRUD lifecycle', () => {
  test('uploads an attachment, verifies metadata on Note and streams bytes, deletes attachment, and confirms 404 and disk cleanup', async (t) => {
    // Arrange
    const { app, accessToken, note } = await createNote(t, {
      title: 'Attachment Host Note',
      body: 'Holds lifecycle attachment',
    })
    const noteId = note.data.id
    const headers = { Authorization: `Bearer ${accessToken}` }
    const content = 'Lifecycle attachment payload bytes'
    const form = buildUploadForm(content, {
      filename: 'architecture-notes.txt',
      contentType: 'text/plain',
    })

    // Create (POST /files/upload?noteId=...)
    const uploadRes = await app.inject({
      method: 'POST',
      url: `/files/upload?noteId=${noteId}`,
      headers: {
        ...form.getHeaders(),
        ...headers,
      },
      payload: form,
    })
    assert.equal(uploadRes.statusCode, 201)
    const uploadedFile = uploadRes.json().files[0]
    const serverPath = registerFileCleanup(
      t,
      uploadedFile.fileId,
      uploadedFile.originalFilename,
      app.notesFileManager.uploadDir,
    )
    assert.equal(await fileExists(serverPath), true)

    // Read metadata on Note (GET /notes/:id) & stream attachment (GET /files/:fileId)
    const noteReadRes = await app.inject({
      method: 'GET',
      url: `/notes/${noteId}`,
      headers,
    })
    assert.equal(noteReadRes.statusCode, 200)
    assert.equal(noteReadRes.json().data.revision, 2)
    assert.equal(noteReadRes.json().data.attachments.length, 1)
    assert.equal(noteReadRes.json().data.attachments[0].fileId, uploadedFile.fileId)

    const downloadRes = await app.inject({
      method: 'GET',
      url: `/files/${uploadedFile.fileId}?noteId=${noteId}`,
      headers,
    })
    assert.equal(downloadRes.statusCode, 200)
    assert.equal(downloadRes.body, content)

    // Delete (DELETE /files/:fileId?noteId=...) and confirm 404 + disk removal + revision 3
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/files/${uploadedFile.fileId}?noteId=${noteId}`,
      headers,
    })
    assert.equal(deleteRes.statusCode, 204)
    assert.equal(await fileExists(serverPath), false)

    const afterDeleteDownloadRes = await app.inject({
      method: 'GET',
      url: `/files/${uploadedFile.fileId}?noteId=${noteId}`,
      headers,
    })
    assert.equal(afterDeleteDownloadRes.statusCode, 404)

    const noteAfterDeleteRes = await app.inject({
      method: 'GET',
      url: `/notes/${noteId}`,
      headers,
    })
    assert.equal(noteAfterDeleteRes.statusCode, 200)
    assert.equal(noteAfterDeleteRes.json().data.revision, 3)
    assert.deepEqual(noteAfterDeleteRes.json().data.attachments, [])
  })
})
