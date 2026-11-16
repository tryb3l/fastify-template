'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { seedUser } = require('../../utils/setup-user')

describe('GET /users/me', () => {
  test('returns 200 with normalized id and profile fields excluding _id and hash', async (t) => {
    // Arrange
    const actor = await seedUser(t, { role: 'user', emailVerified: true })

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: '/users/me',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const data = response.json().data
    assert.equal(data.id, actor.userId)
    assert.equal(data.username, actor.username)
    assert.equal(data.email, actor.email)
    assert.equal(data.emailVerified, true)
    assert.equal(data.role, 'user')
    assert.ok(data.createdAt)
    assert.ok(data.modifiedAt)
    assert.equal(data._id, undefined)
    assert.equal(data.hash, undefined)
  })

  test('returns 401 when unauthenticated', async (t) => {
    // Arrange
    const { app } = await seedUser(t)

    // Act
    const response = await app.inject({
      method: 'GET',
      url: '/users/me',
    })

    // Assert
    assert.equal(response.statusCode, 401)
  })

  test('returns 401 when using stale token of a soft-deleted user', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    await actor.app.usersDataSource.deleteUser(actor.userId)

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: '/users/me',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 401)
  })
})
