'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { setup } = require('../utils/setup-user')
const { randomUsername, randomEmail, randomPassword } = require('../utils/data-creator')

describe('Users CRUD lifecycle', () => {
  test('registers via Argon2id, authenticates, reads self/item/list, updates self and admin fields, deletes, and confirms 404/401', async (t) => {
    // Arrange
    const admin = await setup(t, 'admin')
    const username = randomUsername(12)
    const email = randomEmail(10, 5)
    const password = randomPassword(15)

    // Create (POST /auth/register + POST /auth/authenticate with unmocked Argon2id)
    const registerRes = await admin.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        username,
        email,
        password,
        firstName: 'Ada',
        lastName: 'Lovelace',
      },
    })
    assert.equal(registerRes.statusCode, 201)

    const loginRes = await admin.app.inject({
      method: 'POST',
      url: '/auth/authenticate',
      payload: { username, password },
    })
    assert.equal(loginRes.statusCode, 200)
    const userAccessToken = loginRes.json().access_token
    const userId = loginRes.json().user.id

    // Read (GET /users/me, GET /users/:id, GET /users)
    const meRes = await admin.app.inject({
      method: 'GET',
      url: '/users/me',
      headers: { Authorization: `Bearer ${userAccessToken}` },
    })
    assert.equal(meRes.statusCode, 200)
    assert.equal(meRes.json().data.id, userId)
    assert.equal(meRes.json().data.username, username.toLowerCase())

    const byIdRes = await admin.app.inject({
      method: 'GET',
      url: `/users/${userId}`,
      headers: { Authorization: `Bearer ${admin.accessToken}` },
    })
    assert.equal(byIdRes.statusCode, 200)
    assert.equal(byIdRes.json().data.email, email.toLowerCase())

    const listRes = await admin.app.inject({
      method: 'GET',
      url: `/users?username=${encodeURIComponent(username)}`,
      headers: { Authorization: `Bearer ${admin.accessToken}` },
    })
    assert.equal(listRes.statusCode, 200)
    assert.equal(listRes.json().totalCount, 1)
    assert.equal(listRes.json().data[0].id, userId)

    // Update (PUT /users/me + PUT /users/:id)
    const updatedUsername = randomUsername(12)
    const putMeRes = await admin.app.inject({
      method: 'PUT',
      url: '/users/me',
      headers: { Authorization: `Bearer ${userAccessToken}` },
      payload: { username: updatedUsername, firstName: 'Augusta' },
    })
    assert.equal(putMeRes.statusCode, 200)
    assert.equal(putMeRes.json().data.username, updatedUsername.toLowerCase())
    assert.equal(putMeRes.json().data.firstName, 'Augusta')

    const putAdminRes = await admin.app.inject({
      method: 'PUT',
      url: `/users/${userId}`,
      headers: { Authorization: `Bearer ${admin.accessToken}` },
      payload: { lastName: 'Byron', role: 'admin' },
    })
    assert.equal(putAdminRes.statusCode, 204)

    const verifyUpdatedRes = await admin.app.inject({
      method: 'GET',
      url: `/users/${userId}`,
      headers: { Authorization: `Bearer ${admin.accessToken}` },
    })
    assert.equal(verifyUpdatedRes.statusCode, 200)
    assert.equal(verifyUpdatedRes.json().data.lastName, 'Byron')
    assert.equal(verifyUpdatedRes.json().data.role, 'admin')

    // Delete (DELETE /users/:id) and confirm 404 / 401 afterward
    const deleteRes = await admin.app.inject({
      method: 'DELETE',
      url: `/users/${userId}`,
      headers: { Authorization: `Bearer ${admin.accessToken}` },
    })
    assert.equal(deleteRes.statusCode, 204)

    const afterDeleteByIdRes = await admin.app.inject({
      method: 'GET',
      url: `/users/${userId}`,
      headers: { Authorization: `Bearer ${admin.accessToken}` },
    })
    assert.equal(afterDeleteByIdRes.statusCode, 404)

    const afterDeleteMeRes = await admin.app.inject({
      method: 'GET',
      url: '/users/me',
      headers: { Authorization: `Bearer ${userAccessToken}` },
    })
    assert.equal(afterDeleteMeRes.statusCode, 401)
  })
})
