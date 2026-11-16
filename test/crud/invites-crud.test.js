'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { seedUser } = require('../utils/setup-user')
const { randomEmail } = require('../utils/data-creator')

describe('User Invitations CRUD lifecycle', () => {
  test('creates an invitation, lists active metadata without secretHash, revokes it, and confirms revocation state', async (t) => {
    // Arrange
    const admin = await seedUser(t, { role: 'admin' })
    const inviteEmail = randomEmail(10, 5)

    // Create (POST /users/invites)
    const createRes = await admin.app.inject({
      method: 'POST',
      url: '/users/invites',
      headers: { Authorization: `Bearer ${admin.accessToken}` },
      payload: { email: inviteEmail, role: 'user', ttlHours: 48 },
    })
    assert.equal(createRes.statusCode, 201)
    const created = createRes.json().data
    assert.ok(created.id)
    assert.ok(created.inviteToken)
    assert.equal(created.email, inviteEmail.toLowerCase())
    assert.equal(created.role, 'user')

    // Read list (GET /users/invites)
    const listRes = await admin.app.inject({
      method: 'GET',
      url: '/users/invites',
      headers: { Authorization: `Bearer ${admin.accessToken}` },
    })
    assert.equal(listRes.statusCode, 200)
    const listedInvite = listRes.json().data.find((inv) => inv.id === created.id)
    assert.ok(listedInvite)
    assert.equal(listedInvite.email, inviteEmail.toLowerCase())
    assert.equal(listedInvite.consumedAt, null)
    assert.equal(listedInvite.consumedBy, null)
    assert.equal(Object.hasOwn(listedInvite, 'secretHash'), false)

    // Delete / Revoke (DELETE /users/invites/:id)
    const deleteRes = await admin.app.inject({
      method: 'DELETE',
      url: `/users/invites/${created.id}`,
      headers: { Authorization: `Bearer ${admin.accessToken}` },
    })
    assert.equal(deleteRes.statusCode, 204)

    // Confirm revoked invite is excluded from active list and subsequent delete returns 404
    const afterRevokeListRes = await admin.app.inject({
      method: 'GET',
      url: '/users/invites',
      headers: { Authorization: `Bearer ${admin.accessToken}` },
    })
    assert.equal(afterRevokeListRes.statusCode, 200)
    assert.equal(
      afterRevokeListRes.json().data.some((inv) => inv.id === created.id),
      false,
    )

    const repeatDeleteRes = await admin.app.inject({
      method: 'DELETE',
      url: `/users/invites/${created.id}`,
      headers: { Authorization: `Bearer ${admin.accessToken}` },
    })
    assert.equal(repeatDeleteRes.statusCode, 404)
  })
})
