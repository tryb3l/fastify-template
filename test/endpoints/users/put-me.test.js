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

  test('returns 400 when payload includes unknown properties', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const bystander = await seedUser(t, { app: actor.app })

    // Act
    const roleAttempt = await actor.app.inject({
      method: 'PUT',
      url: '/users/me',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { role: 'admin' },
    })
    const identityAttempt = await actor.app.inject({
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
    assert.equal(roleAttempt.statusCode, 400)
    assert.equal(identityAttempt.statusCode, 400)

    const currentActor = await actor.app.usersDataSource.readUserDetails(actor.userId)
    assert.equal(currentActor.role, 'user')
    assert.equal(currentActor.username, actor.username)
  })

  test('returns 400 when username or email violates schema constraints', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const shortUsernameRes = await actor.app.inject({
      method: 'PUT',
      url: '/users/me',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { username: 'ab' },
    })
    const badEmailRes = await actor.app.inject({
      method: 'PUT',
      url: '/users/me',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { email: 'not-an-email' },
    })

    // Assert
    assert.equal(shortUsernameRes.statusCode, 400)
    assert.equal(badEmailRes.statusCode, 400)
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

  test('returns 409 when updating username or email to an existing user', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const existing = await seedUser(t, { app: actor.app })

    // Act
    const duplicateUsernameRes = await actor.app.inject({
      method: 'PUT',
      url: '/users/me',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { username: existing.username.toUpperCase() },
    })
    const duplicateEmailRes = await actor.app.inject({
      method: 'PUT',
      url: '/users/me',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { email: existing.email.toUpperCase() },
    })

    // Assert
    assert.equal(duplicateUsernameRes.statusCode, 409)
    assert.equal(duplicateEmailRes.statusCode, 409)
  })
})
