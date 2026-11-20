'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { setTimeout: delay } = require('node:timers/promises')
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

  test('returns 400 when skip exceeds maximum bound', async (t) => {
    // Arrange
    const admin = await seedUser(t, { role: 'admin' })

    // Act
    const response = await admin.app.inject({
      method: 'GET',
      url: '/users?skip=10001',
      headers: { Authorization: `Bearer ${admin.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns deterministic reverse-chronological UUIDv7 pagination order across pages', async (t) => {
    // Arrange: space creations across distinct millisecond ticks so native crypto.randomUUIDv7()
    // 48-bit Unix epoch timestamps strictly increase (admin < userOne < userTwo)
    const admin = await seedUser(t, { role: 'admin' })
    await delay(2)
    const userOne = await seedUser(t, { app: admin.app, role: 'user' })
    await delay(2)
    const userTwo = await seedUser(t, { app: admin.app, role: 'user' })

    assert.ok(admin.userId < userOne.userId)
    assert.ok(userOne.userId < userTwo.userId)

    // Act: retry if a parallel test worker inserted a user between page1 and page2
    let page1
    let page2
    let fullWindow
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const beforeCount = (
        await admin.app.inject({
          method: 'GET',
          url: '/users?limit=1&skip=0',
          headers: { Authorization: `Bearer ${admin.accessToken}` },
        })
      ).json().totalCount

      page1 = await admin.app.inject({
        method: 'GET',
        url: '/users?limit=1&skip=0',
        headers: { Authorization: `Bearer ${admin.accessToken}` },
      })
      page2 = await admin.app.inject({
        method: 'GET',
        url: '/users?limit=1&skip=1',
        headers: { Authorization: `Bearer ${admin.accessToken}` },
      })
      fullWindow = await admin.app.inject({
        method: 'GET',
        url: '/users?limit=100&skip=0',
        headers: { Authorization: `Bearer ${admin.accessToken}` },
      })

      if (fullWindow.json().totalCount === beforeCount) {
        break
      }
    }

    // Assert
    assert.equal(page1.statusCode, 200)
    assert.equal(page2.statusCode, 200)
    assert.equal(fullWindow.statusCode, 200)

    const windowIds = fullWindow.json().data.map((u) => u.id)
    assert.equal(page1.json().data[0].id, windowIds[0])
    assert.equal(page2.json().data[0].id, windowIds[1])

    const idxTwo = windowIds.indexOf(userTwo.userId)
    const idxOne = windowIds.indexOf(userOne.userId)
    const idxAdmin = windowIds.indexOf(admin.userId)
    assert.ok(idxTwo !== -1 && idxOne !== -1 && idxAdmin !== -1)
    assert.ok(idxTwo < idxOne && idxOne < idxAdmin)
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
