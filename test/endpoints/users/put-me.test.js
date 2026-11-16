'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { randomEmail, randomUsername } = require('../../utils/data-creator')
const { seedUser, setup } = require('../../utils/setup-user')

describe('PUT /users/me', () => {
  test('returns 200 and updates self username, firstName, and lastName', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const newUsername = randomUsername(14)

    // Act
    const response = await actor.app.inject({
      method: 'PUT',
      url: '/users/me',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: {
        username: newUsername.toUpperCase(),
        firstName: 'Ada',
        lastName: 'Lovelace',
      },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const data = response.json().data
    assert.equal(data.id, actor.userId)
    assert.equal(data.username, newUsername.toLowerCase())
    assert.equal(data.firstName, 'Ada')
    assert.equal(data.lastName, 'Lovelace')
    assert.equal(data._id, undefined)
  })

  test('returns 200 on email update, resets emailVerified to false, and invalidates prior token', async (t) => {
    // Arrange
    const actor = await setup(t, 'user', { REGISTRATION_MODE: 'open' })
    await actor.app.usersDataSource.updateUser(actor.userId, { emailVerified: true })
    const newEmail = randomEmail(10, 5)

    // Act
    const response = await actor.app.inject({
      method: 'PUT',
      url: '/users/me',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { email: newEmail.toUpperCase() },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const data = response.json().data
    assert.equal(data.email, newEmail.toLowerCase())
    assert.equal(data.emailVerified, false)

    const staleTokenRes = await actor.app.inject({
      method: 'GET',
      url: '/users/me',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })
    assert.equal(staleTokenRes.statusCode, 401)
  })

  test('returns 400 when attempting to escalate own role', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'PUT',
      url: '/users/me',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { role: 'admin' },
    })

    // Assert
    assert.equal(response.statusCode, 400)
    const currentActor = await actor.app.usersDataSource.readUserDetails(actor.userId)
    assert.equal(currentActor.role, 'user')
  })

  test('returns 400 when payload includes forbidden identity or deleted fields', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const bystander = await seedUser(t, { app: actor.app })

    // Act
    const response = await actor.app.inject({
      method: 'PUT',
      url: '/users/me',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: {
        username: randomUsername(14),
        userId: bystander.userId,
        deleted: true,
      },
    })

    // Assert
    assert.equal(response.statusCode, 400)
    const currentActor = await actor.app.usersDataSource.readUserDetails(actor.userId)
    assert.equal(currentActor.username, actor.username)
  })

  test('returns 400 when username is shorter than minimum length', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'PUT',
      url: '/users/me',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { username: 'ab' },
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 400 when email format is invalid', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'PUT',
      url: '/users/me',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { email: 'not-an-email' },
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 401 when unauthenticated', async (t) => {
    // Arrange
    const { app } = await seedUser(t)

    // Act
    const response = await app.inject({
      method: 'PUT',
      url: '/users/me',
      payload: { username: randomUsername(12) },
    })

    // Assert
    assert.equal(response.statusCode, 401)
  })

  test('returns 200 without modifying profile fields when update payload is empty', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'PUT',
      url: '/users/me',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: {},
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const data = response.json().data
    assert.equal(data.id, actor.userId)
    assert.equal(data.username, actor.username)
    assert.equal(data.email, actor.email)
  })

  test('returns 409 when updating username to an existing user', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const existing = await seedUser(t, { app: actor.app })

    // Act
    const response = await actor.app.inject({
      method: 'PUT',
      url: '/users/me',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { username: existing.username.toUpperCase() },
    })

    // Assert
    assert.equal(response.statusCode, 409)
  })

  test('returns 409 when updating email to an existing user', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const existing = await seedUser(t, { app: actor.app })

    // Act
    const response = await actor.app.inject({
      method: 'PUT',
      url: '/users/me',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { email: existing.email.toUpperCase() },
    })

    // Assert
    assert.equal(response.statusCode, 409)
  })
})
