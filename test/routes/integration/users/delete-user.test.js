'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { MongoClient } = require('mongodb')
const { setup } = require('../../../utils/setup-user')
const { flushAuditLogs } = require('../../../utils/audit')

async function readAuditLogs(mongoUrl, filter) {
  const client = new MongoClient(mongoUrl)
  await client.connect()

  try {
    return await client.db().collection('auditLogs').find(filter).sort({ createdAt: 1 }).toArray()
  } finally {
    await client.close()
  }
}

async function waitForAuditLogs(mongoUrl, filter, minimumCount = 1) {
  const deadline = Date.now() + 1500

  while (Date.now() < deadline) {
    const logs = await readAuditLogs(mongoUrl, filter)
    if (logs.length >= minimumCount) {
      return logs
    }

    await new Promise((resolve) => setTimeout(resolve, 25))
  }

  return await readAuditLogs(mongoUrl, filter)
}

async function deleteCurrentUser(app, accessToken) {
  return await app.inject({
    method: 'DELETE',
    url: '/users/me',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
}

test('DELETE /users/me 204 - Deletes self', async (t) => {
  // Arrange
  const { app, accessToken } = await setup(t, 'user')

  // Act
  const response = await deleteCurrentUser(app, accessToken)

  // Assert
  assert.strictEqual(response.statusCode, 204)
})

test('DELETE /users/me 204 - Deletes only the authenticated user', async (t) => {
  // Arrange
  const actor = await setup(t, 'user')
  const bystander = await setup(t, 'user')

  // Act
  const response = await deleteCurrentUser(actor.app, actor.accessToken)

  // Assert
  assert.strictEqual(response.statusCode, 204)

  const bystanderVerify = await bystander.app.inject({
    method: 'GET',
    url: '/users/me',
    headers: { Authorization: `Bearer ${bystander.accessToken}` },
  })

  assert.strictEqual(bystanderVerify.statusCode, 200)
  assert.strictEqual(bystanderVerify.json().data.username, bystander.username)
})

test('DELETE /users/me 204 - Writes an audit log for self delete', async (t) => {
  // Arrange
  const { app, accessToken, userId, mongoUrl } = await setup(t, 'user')

  // Act
  const response = await deleteCurrentUser(app, accessToken)

  // Assert
  assert.strictEqual(response.statusCode, 204)
  await flushAuditLogs()

  const auditLogs = await waitForAuditLogs(mongoUrl, {
    action: 'user_soft_deleted',
    userId,
    resourceType: 'user',
    resourceId: userId,
  })

  assert.strictEqual(auditLogs.length, 1)
  assert.strictEqual(auditLogs[0].userId, userId)
  assert.strictEqual(auditLogs[0].resourceId, userId)
  assert.strictEqual(auditLogs[0].resourceType, 'user')
  assert.strictEqual(typeof auditLogs[0].requestId, 'string')
})

test('GET /users/me 401 - Rejects the stale token after self delete', async (t) => {
  // Arrange
  const { app, accessToken } = await setup(t, 'user')
  const deleteResponse = await deleteCurrentUser(app, accessToken)
  assert.strictEqual(deleteResponse.statusCode, 204)

  // Act
  const meVerify = await app.inject({
    method: 'GET',
    url: '/users/me',
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  assert.strictEqual(meVerify.statusCode, 401)
})

test('DELETE /users/:id 204 - Admin deletes other users', async (t) => {
  // Arrange
  const { app, accessToken: adminToken } = await setup(t, 'admin')
  const { userId } = await setup(t, 'user')

  // Act
  const response = await app.inject({
    method: 'DELETE',
    url: `/users/${userId}`,
    headers: { Authorization: `Bearer ${adminToken}` },
  })

  // Assert
  assert.strictEqual(response.statusCode, 204)
})

test('DELETE /users/me 204 - Cascade purges notebooks, folders, notes, disk attachments, and frees email/username for re-registration', async (t) => {
  const fs = require('node:fs/promises')
  const path = require('node:path')
  const FormData = require('form-data')
  const actor = await setup(t, 'user')

  const nbRes = await actor.app.inject({
    method: 'POST',
    url: '/notebooks',
    headers: { Authorization: `Bearer ${actor.accessToken}` },
    payload: { name: 'Cascade Notebook' },
  })
  assert.strictEqual(nbRes.statusCode, 201)
  const notebookId = nbRes.json().data.id

  const fldRes = await actor.app.inject({
    method: 'POST',
    url: `/notebooks/${notebookId}/folders`,
    headers: { Authorization: `Bearer ${actor.accessToken}` },
    payload: { name: 'Cascade Folder' },
  })
  assert.strictEqual(fldRes.statusCode, 201)
  const folderId = fldRes.json().data.id

  const noteRes = await actor.app.inject({
    method: 'POST',
    url: '/notes',
    headers: { Authorization: `Bearer ${actor.accessToken}` },
    payload: { title: 'Cascade Note', body: 'Hello', notebookId, folderId },
  })
  assert.strictEqual(noteRes.statusCode, 201)
  const noteId = noteRes.json().data.id

  // Attach a physical file to the user's note and verify it is unlinked on user deletion
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
  assert.strictEqual(uploadRes.statusCode, 201)
  const uploadedFileId = uploadRes.json().files[0].fileId
  const blobPath = path.join(process.cwd(), 'uploads', `${uploadedFileId}.txt`)

  const existsBeforeDelete = await fs
    .access(blobPath)
    .then(() => true)
    .catch(() => false)
  assert.strictEqual(existsBeforeDelete, true)

  const delRes = await deleteCurrentUser(actor.app, actor.accessToken)
  assert.strictEqual(delRes.statusCode, 204)

  const existsAfterDelete = await fs
    .access(blobPath)
    .then(() => true)
    .catch(() => false)
  assert.strictEqual(
    existsAfterDelete,
    false,
    'Physical attachment file must be deleted when user is deleted',
  )

  // Re-registering with the original username and email succeeds and starts with an empty workspace
  const reRegisterRes = await actor.app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: {
      username: actor.username,
      email: actor.email,
      password: actor.password,
    },
  })
  assert.strictEqual(reRegisterRes.statusCode, 201)

  const reLoginRes = await actor.app.inject({
    method: 'POST',
    url: '/auth/authenticate',
    payload: { username: actor.username, password: actor.password },
  })
  assert.strictEqual(reLoginRes.statusCode, 200)
  const newAccessToken = reLoginRes.json().access_token

  const treeRes = await actor.app.inject({
    method: 'GET',
    url: '/notebooks/tree',
    headers: { Authorization: `Bearer ${newAccessToken}` },
  })
  assert.strictEqual(treeRes.statusCode, 200)
  assert.strictEqual(treeRes.json().data.inboxNoteCount, 0)
  assert.deepStrictEqual(treeRes.json().data.notebooks, [])
})
