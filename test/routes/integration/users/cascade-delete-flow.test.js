'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const FormData = require('form-data')
const { setup } = require('../../../utils/setup-user')

describe('Cascade user deletion workflow', () => {
  test('cascade purges notebooks, folders, notes, disk attachments, dailyActivity, and frees email/username for re-registration', async (t) => {
    // Arrange
    const actor = await setup(t, 'user')

    const nbRes = await actor.app.inject({
      method: 'POST',
      url: '/notebooks',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { name: 'Cascade Notebook' },
    })
    assert.equal(nbRes.statusCode, 201)
    const notebookId = nbRes.json().data.id

    const fldRes = await actor.app.inject({
      method: 'POST',
      url: `/notebooks/${notebookId}/folders`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { name: 'Cascade Folder' },
    })
    assert.equal(fldRes.statusCode, 201)
    const folderId = fldRes.json().data.id

    const noteRes = await actor.app.inject({
      method: 'POST',
      url: '/notes',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { title: 'Cascade Note', body: 'Hello', notebookId, folderId },
    })
    assert.equal(noteRes.statusCode, 201)
    const noteId = noteRes.json().data.id

    const form = new FormData()
    form.append('file', Buffer.from('user-cascade-blob'), {
      filename: 'cascade.txt',
      contentType: 'text/plain',
    })
    const uploadRes = await actor.app.inject({
      method: 'POST',
      url: `/files/upload?noteId=${noteId}`,
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${actor.accessToken}`,
      },
      payload: form,
    })
    assert.equal(uploadRes.statusCode, 201)
    const uploadedFileId = uploadRes.json().files[0].fileId
    const blobPath = path.join(process.cwd(), 'uploads', `${uploadedFileId}.txt`)

    const existsBeforeDelete = await fs
      .access(blobPath)
      .then(() => true)
      .catch(() => false)
    assert.equal(existsBeforeDelete, true)

    const summaryBeforeDelRes = await actor.app.inject({
      method: 'GET',
      url: '/dashboard/summary',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })
    assert.equal(summaryBeforeDelRes.statusCode, 200)
    assert.equal(summaryBeforeDelRes.json().data.velocity14Days.totals.notesCreated, 1)

    // Act
    const delRes = await actor.app.inject({
      method: 'DELETE',
      url: '/users/me',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(delRes.statusCode, 204)

    const remainingActivity = await actor.app.mongo.db
      .collection('dailyActivity')
      .countDocuments({ userId: actor.userId })
    assert.equal(remainingActivity, 0)

    const existsAfterDelete = await fs
      .access(blobPath)
      .then(() => true)
      .catch(() => false)
    assert.equal(existsAfterDelete, false)

    const reRegisterRes = await actor.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        username: actor.username,
        email: actor.email,
        password: actor.password,
      },
    })
    assert.equal(reRegisterRes.statusCode, 201)

    const reLoginRes = await actor.app.inject({
      method: 'POST',
      url: '/auth/authenticate',
      payload: { username: actor.username, password: actor.password },
    })
    assert.equal(reLoginRes.statusCode, 200)
    const newAccessToken = reLoginRes.json().access_token

    const treeRes = await actor.app.inject({
      method: 'GET',
      url: '/notebooks/tree',
      headers: { Authorization: `Bearer ${newAccessToken}` },
    })
    assert.equal(treeRes.statusCode, 200)
    assert.equal(treeRes.json().data.inboxNoteCount, 0)
    assert.deepEqual(treeRes.json().data.notebooks, [])
  })
})
