'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUIDv7 } = require('node:crypto')
const { generateMalformedUUIDs } = require('../../utils/data-creator')
const { seedUser } = require('../../utils/setup-user')

describe('GET /users/:id', () => {
  test('returns 200 with normalized user profile for admin', async (t) => {
    // Arrange
    const admin = await seedUser(t, { role: 'admin' })
    const target = await seedUser(t, { app: admin.app, role: 'user' })

    // Act
    const response = await admin.app.inject({
      method: 'GET',
      url: `/users/${target.userId}`,
      headers: { Authorization: `Bearer ${admin.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const data = response.json().data
    assert.equal(data.id, target.userId)
    assert.equal(data.username, target.username)
    assert.equal(data.email, target.email)
    assert.equal(data.role, 'user')
    assert.ok(data.createdAt)
    assert.ok(data.modifiedAt)
    assert.equal(data._id, undefined)
    assert.equal(data.hash, undefined)
  })

  test('returns 400 when user id is not a valid UUID', async (t) => {
    // Arrange
    const admin = await seedUser(t, { role: 'admin' })
    const { tooShort } = generateMalformedUUIDs()

    // Act
    const response = await admin.app.inject({
      method: 'GET',
      url: `/users/${tooShort}`,
      headers: { Authorization: `Bearer ${admin.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 401 when unauthenticated', async (t) => {
    // Arrange
    const target = await seedUser(t)

    // Act
    const response = await target.app.inject({
      method: 'GET',
      url: `/users/${target.userId}`,
    })

    // Assert
    assert.equal(response.statusCode, 401)
  })

  test('returns 403 when caller is a regular non-admin user', async (t) => {
    // Arrange
    const regularUser = await seedUser(t, { role: 'user' })

    // Act
    const response = await regularUser.app.inject({
      method: 'GET',
      url: `/users/${regularUser.userId}`,
      headers: { Authorization: `Bearer ${regularUser.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 403)
  })

  test('returns 404 when user does not exist', async (t) => {
    // Arrange
    const admin = await seedUser(t, { role: 'admin' })

    // Act
    const response = await admin.app.inject({
      method: 'GET',
      url: `/users/${randomUUIDv7()}`,
      headers: { Authorization: `Bearer ${admin.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 404)
  })
})
