'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { setImmediate: nextImmediate } = require('node:timers/promises')
const mailerPlugin = require('../../plugins/mailer')
const { buildApp } = require('../test-setup')
const { setup } = require('../utils/setup-user')
const { randomEmail, randomPassword, randomUsername } = require('../utils/data-creator')
const { extractEmailVerificationToken, extractResetToken } = require('../utils/auth-tokens')
const {
  buildRefreshTokenCookieHeader,
  findRefreshCookie,
  issueCsrfContext,
} = require('../utils/csrf')
const { buildUploadForm, fileExists, registerAttachmentCleanup } = require('../utils/notes-files')

describe('Authentication, recovery, and cascade account deletion E2E workflow', () => {
  test('completes open registration, email verification, CSRF refresh rotation, password reset invalidating prior sessions, and self-delete cascade freeing PII', async (t) => {
    const app = await buildApp(t, { REGISTRATION_MODE: 'open' })
    const username = randomUsername(12)
    const email = randomEmail(10, 5)
    const initialPassword = randomPassword(16)
    const resetPassword = randomPassword(16)

    // 1. Open registration & initial authentication (full unmocked Argon2id)
    const registerRes = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username, email, password: initialPassword },
    })
    assert.equal(registerRes.statusCode, 201)

    const loginRes = await app.inject({
      method: 'POST',
      url: '/auth/authenticate',
      payload: { username, password: initialPassword },
    })
    assert.equal(loginRes.statusCode, 200)
    const firstAccessToken = loginRes.json().access_token
    const userId = loginRes.json().user.id
    const firstRefreshToken = findRefreshCookie(loginRes.headers['set-cookie'])
      .split(';')[0]
      .split('=')[1]

    // 2. Email verification request & confirmation
    mailerPlugin.clearTestMessages()
    const verifyReqRes = await app.inject({
      method: 'POST',
      url: '/auth/verify-email/request',
      headers: { Authorization: `Bearer ${firstAccessToken}` },
      payload: {},
    })
    assert.equal(verifyReqRes.statusCode, 200)
    const verificationToken = extractEmailVerificationToken(mailerPlugin.getTestMessages()[0].text)

    const verifyConfirmRes = await app.inject({
      method: 'POST',
      url: '/auth/verify-email/confirm',
      payload: { token: verificationToken },
    })
    assert.equal(verifyConfirmRes.statusCode, 200)
    assert.equal(verifyConfirmRes.json().verified, true)

    const meVerifiedRes = await app.inject({
      method: 'GET',
      url: '/users/me',
      headers: { Authorization: `Bearer ${firstAccessToken}` },
    })
    assert.equal(meVerifiedRes.statusCode, 200)
    assert.equal(meVerifiedRes.json().data.emailVerified, true)

    // 3. CSRF-protected refresh token rotation
    const { csrfToken, csrfCookieHeader } = await issueCsrfContext(app)
    const refreshRes = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: {
        cookie: buildRefreshTokenCookieHeader(firstRefreshToken, csrfCookieHeader),
        'x-csrf-token': csrfToken,
      },
    })
    assert.equal(refreshRes.statusCode, 200)
    const rotatedAccessToken = refreshRes.json().access_token
    const rotatedRefreshToken = findRefreshCookie(refreshRes.headers['set-cookie'])
      .split(';')[0]
      .split('=')[1]
    assert.notEqual(rotatedRefreshToken, firstRefreshToken)

    // 4. Password reset request -> validate -> confirm invalidating prior sessions
    mailerPlugin.clearTestMessages()
    const resetReqRes = await app.inject({
      method: 'POST',
      url: '/auth/reset-password/request',
      payload: { email },
    })
    assert.equal(resetReqRes.statusCode, 200)
    const { resetId, secret } = extractResetToken(mailerPlugin.getTestMessages()[0].text)

    const resetValidateRes = await app.inject({
      method: 'POST',
      url: '/auth/reset-password/validate',
      payload: { resetId, secret },
    })
    assert.equal(resetValidateRes.statusCode, 200)
    assert.equal(resetValidateRes.json().valid, true)

    const resetConfirmRes = await app.inject({
      method: 'POST',
      url: '/auth/reset-password/confirm',
      payload: { resetId, secret, newPassword: resetPassword },
    })
    assert.equal(resetConfirmRes.statusCode, 200)
    await nextImmediate()
    await app.flushAuditLogs()

    const resetAudit = await app.mongo.db
      .collection('auditLogs')
      .findOne({ action: 'auth_password_reset_confirmed', userId, resourceId: userId })
    assert.ok(resetAudit)

    // Prior access & refresh tokens are immediately revoked via credentialsVersion
    const staleMeRes = await app.inject({
      method: 'GET',
      url: '/users/me',
      headers: { Authorization: `Bearer ${rotatedAccessToken}` },
    })
    assert.equal(staleMeRes.statusCode, 401)

    const staleRefreshRes = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: {
        cookie: buildRefreshTokenCookieHeader(rotatedRefreshToken, csrfCookieHeader),
        'x-csrf-token': csrfToken,
      },
    })
    assert.equal(staleRefreshRes.statusCode, 401)

    // 5. Authenticate with new password and populate workspace resources
    const postResetLoginRes = await app.inject({
      method: 'POST',
      url: '/auth/authenticate',
      payload: { username, password: resetPassword },
    })
    assert.equal(postResetLoginRes.statusCode, 200)
    const activeHeaders = { Authorization: `Bearer ${postResetLoginRes.json().access_token}` }

    const nbRes = await app.inject({
      method: 'POST',
      url: '/notebooks',
      headers: activeHeaders,
      payload: { name: 'Cascade Notebook' },
    })
    assert.equal(nbRes.statusCode, 201)
    const notebookId = nbRes.json().data.id

    const fldRes = await app.inject({
      method: 'POST',
      url: `/notebooks/${notebookId}/folders`,
      headers: activeHeaders,
      payload: { name: 'Cascade Folder' },
    })
    assert.equal(fldRes.statusCode, 201)
    const folderId = fldRes.json().data.id

    const noteRes = await app.inject({
      method: 'POST',
      url: '/notes',
      headers: activeHeaders,
      payload: { title: 'Cascade Note', body: 'Hello', notebookId, folderId },
    })
    assert.equal(noteRes.statusCode, 201)
    const noteId = noteRes.json().data.id

    const extraNoteRes = await app.inject({
      method: 'POST',
      url: '/notes',
      headers: activeHeaders,
      payload: { title: 'Tombstone Seed Note', body: 'Deleted before cascade' },
    })
    assert.equal(extraNoteRes.statusCode, 201)
    await app.inject({
      method: 'DELETE',
      url: `/notes/${extraNoteRes.json().data.id}?expectedRevision=1`,
      headers: activeHeaders,
    })

    const cardRes = await app.inject({
      method: 'POST',
      url: '/flashcards',
      headers: activeHeaders,
      payload: { noteId, front: 'Cascade Q', back: 'Cascade A' },
    })
    assert.equal(cardRes.statusCode, 201)

    const uploadForm = buildUploadForm('user-cascade-blob', {
      filename: 'cascade.txt',
      contentType: 'text/plain',
    })
    const uploadRes = await app.inject({
      method: 'POST',
      url: `/files/upload?noteId=${noteId}`,
      headers: {
        ...uploadForm.getHeaders(),
        ...activeHeaders,
      },
      payload: uploadForm,
    })
    assert.equal(uploadRes.statusCode, 201)
    const uploadedFile = uploadRes.json().files[0]
    const blobPath = registerAttachmentCleanup(t, {
      ...uploadedFile,
      uploadDir: app.notesFileManager.uploadDir,
    })
    assert.equal(await fileExists(blobPath), true)

    // 6. Self-delete (DELETE /users/me) cascade purges all tenant data, blobs, and frees PII
    const deleteSelfRes = await app.inject({
      method: 'DELETE',
      url: '/users/me',
      headers: activeHeaders,
    })
    assert.equal(deleteSelfRes.statusCode, 204)
    assert.equal(await fileExists(blobPath), false)

    const db = app.mongo.db
    const [nbCount, fldCount, noteCount, cardCount, tombstoneCount, activityCount] =
      await Promise.all([
        db.collection('notebooks').countDocuments({ userId }),
        db.collection('folders').countDocuments({ userId }),
        db.collection('notes').countDocuments({ userId }),
        db.collection('flashcards').countDocuments({ userId }),
        db.collection('syncTombstones').countDocuments({ userId }),
        db.collection('dailyActivity').countDocuments({ userId }),
      ])
    assert.equal(nbCount, 0)
    assert.equal(fldCount, 0)
    assert.equal(noteCount, 0)
    assert.equal(cardCount, 0)
    assert.equal(tombstoneCount, 0)
    assert.equal(activityCount, 0)

    // 7. Re-register with the exact same username and email onto a clean slate
    const reRegisterRes = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username, email, password: resetPassword },
    })
    assert.equal(reRegisterRes.statusCode, 201)

    const reLoginRes = await app.inject({
      method: 'POST',
      url: '/auth/authenticate',
      payload: { username, password: resetPassword },
    })
    assert.equal(reLoginRes.statusCode, 200)

    const freshTreeRes = await app.inject({
      method: 'GET',
      url: '/notebooks/tree',
      headers: { Authorization: `Bearer ${reLoginRes.json().access_token}` },
    })
    assert.equal(freshTreeRes.statusCode, 200)
    assert.deepEqual(freshTreeRes.json().data, {
      inboxNoteCount: 0,
      notebooks: [],
    })
  })

  test('completes invite-gated signup with single-use User Invitation and admin cascade user deletion', async (t) => {
    // Provision admin while open, then enforce invite-only registration on a shared DB or directly via setup
    const admin = await setup(t, 'admin')
    const inviteApp = await buildApp(t, { REGISTRATION_MODE: 'invite' })
    const invitedEmail = randomEmail(10, 5)
    const invitedUsername = randomUsername(12)
    const invitedPassword = randomPassword(16)

    // 1. Admin issues bound User Invitation
    const createInviteRes = await admin.app.inject({
      method: 'POST',
      url: '/users/invites',
      headers: { Authorization: `Bearer ${admin.accessToken}` },
      payload: { email: invitedEmail, role: 'user', ttlHours: 24 },
    })
    assert.equal(createInviteRes.statusCode, 201)
    const { inviteToken } = createInviteRes.json().data

    // 2. Invitee registers on invite-gated instance using single-use token (auto-verified email)
    const registerRes = await inviteApp.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        username: invitedUsername,
        email: invitedEmail,
        password: invitedPassword,
        inviteToken,
      },
    })
    assert.equal(registerRes.statusCode, 201)

    const loginRes = await inviteApp.inject({
      method: 'POST',
      url: '/auth/authenticate',
      payload: { username: invitedUsername, password: invitedPassword },
    })
    assert.equal(loginRes.statusCode, 200)
    const inviteeId = loginRes.json().user.id
    const inviteeHeaders = { Authorization: `Bearer ${loginRes.json().access_token}` }

    const meRes = await inviteApp.inject({
      method: 'GET',
      url: '/users/me',
      headers: inviteeHeaders,
    })
    assert.equal(meRes.statusCode, 200)
    assert.equal(meRes.json().data.emailVerified, true)

    // Create a note so admin cascade deletion verifies resource purge
    const noteRes = await inviteApp.inject({
      method: 'POST',
      url: '/notes',
      headers: inviteeHeaders,
      payload: { title: 'Invitee Note', body: 'Purged on admin delete' },
    })
    assert.equal(noteRes.statusCode, 201)

    // 3. Admin deletes invitee account (DELETE /users/:id) and frees PII
    const adminDeleteRes = await admin.app.inject({
      method: 'DELETE',
      url: `/users/${inviteeId}`,
      headers: { Authorization: `Bearer ${admin.accessToken}` },
    })
    assert.equal(adminDeleteRes.statusCode, 204)

    const remainingNotes = await admin.app.mongo.db
      .collection('notes')
      .countDocuments({ userId: inviteeId })
    assert.equal(remainingNotes, 0)
  })
})
