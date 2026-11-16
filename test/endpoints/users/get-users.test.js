'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUsername } = require('../../utils/data-creator')
const { seedUser } = require('../../utils/setup-user')

describe('GET /users', () => {
  test('returns 200 with paginated user records and totalCount for admin', async (t) => {
    // Arrange
    const admin = await seedUser(t, { role: 'admin' })
    await seedUser(t, { app: admin.app, role: 'user' })
    await seedUser(t, { app: admin.app, role: 'user' })

    // Act
    const response = await admin.app.inject({
      method: 'GET',
      url: '/users?limit=2&skip=0',
      headers: { Authorization: `Bearer ${admin.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const body = response.json()
    assert.ok(Array.isArray(body.data))
    assert.equal(body.data.length, 2)
    assert.equal(typeof body.totalCount, 'number')
    assert.ok(body.totalCount >= 3)
    for (const user of body.data) {
      assert.equal(typeof user.id, 'string')
      assert.ok(user.id.length > 0)
      assert.equal(user._id, undefined)
      assert.equal(user.hash, undefined)
    }
  })

  test('returns 200 filtered by case-insensitive username', async (t) => {
    // Arrange
    const admin = await seedUser(t, { role: 'admin' })
    const uniqueUsername = randomUsername(16)
    const target = await seedUser(t, {
      app: admin.app,
      role: 'user',
      username: uniqueUsername,
    })

    // Act
    const response = await admin.app.inject({
      method: 'GET',
      url: `/users?username=${uniqueUsername.toUpperCase()}`,
      headers: { Authorization: `Bearer ${admin.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const body = response.json()
    assert.equal(body.totalCount, 1)
    assert.equal(body.data.length, 1)
    assert.equal(body.data[0].id, target.userId)
    assert.equal(body.data[0].username, uniqueUsername.toLowerCase())
  })

  test('returns 400 when skip is negative', async (t) => {
    // Arrange
    const admin = await seedUser(t, { role: 'admin' })

    // Act
    const response = await admin.app.inject({
      method: 'GET',
      url: '/users?skip=-1',
      headers: { Authorization: `Bearer ${admin.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 400 when limit exceeds maximum bound', async (t) => {
    // Arrange
    const admin = await seedUser(t, { role: 'admin' })

    // Act
    const response = await admin.app.inject({
      method: 'GET',
      url: '/users?limit=101',
      headers: { Authorization: `Bearer ${admin.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 401 when unauthenticated', async (t) => {
    // Arrange
    const { app } = await seedUser(t)

    // Act
    const response = await app.inject({
      method: 'GET',
      url: '/users',
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
      url: '/users',
      headers: { Authorization: `Bearer ${regularUser.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 403)
  })
})
