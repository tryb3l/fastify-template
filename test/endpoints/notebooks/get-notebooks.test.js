'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { setTimeout: delay } = require('node:timers/promises')
const { seedUser } = require('../../utils/setup-user')

describe('GET /notebooks', () => {
  test('returns 200 with notebooks sorted by modifiedAt descending excluding internal fields', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const older = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Older Notebook', description: 'First' },
      actor.userId,
    )
    await delay(15)
    const newer = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Newer Notebook', description: 'Second' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: '/notebooks',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const { data } = response.json()
    assert.equal(data.length, 2)
    assert.equal(data[0].id, newer.id)
    assert.equal(data[1].id, older.id)
    assert.equal(Object.hasOwn(data[0], '_id'), false)
    assert.equal(Object.hasOwn(data[0], 'userId'), false)
  })

  test('returns 200 filtered by mode=campaign and status=active', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    await actor.app.notebooksDataSource.createNotebook(
      { name: 'Evergreen KB', mode: 'notebook' },
      actor.userId,
    )
    const activeCampaign = await actor.app.notebooksDataSource.createNotebook(
      {
        name: 'Staff Backend Interview',
        mode: 'campaign',
        status: 'active',
        targetDate: '2026-12-15T09:00:00.000Z',
      },
      actor.userId,
    )
    await actor.app.notebooksDataSource.createNotebook(
      { name: 'Completed Prep', mode: 'campaign', status: 'archived' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: '/notebooks?mode=campaign&status=active',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const { data } = response.json()
    assert.equal(data.length, 1)
    assert.equal(data[0].id, activeCampaign.id)
    assert.equal(data[0].mode, 'campaign')
    assert.equal(data[0].status, 'active')
    assert.equal(data[0].targetDate, '2026-12-15T09:00:00.000Z')
  })

  test('returns 200 filtered by mode=campaign and status=archived', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    await actor.app.notebooksDataSource.createNotebook(
      { name: 'Active Campaign', mode: 'campaign', status: 'active' },
      actor.userId,
    )
    const archivedCampaign = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Archived Campaign', mode: 'campaign', status: 'archived' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: '/notebooks?mode=campaign&status=archived',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const { data } = response.json()
    assert.equal(data.length, 1)
    assert.equal(data[0].id, archivedCampaign.id)
    assert.equal(data[0].status, 'archived')
  })

  test('returns 200 filtered by mode=notebook', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const evergreen = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Distributed Systems', mode: 'notebook' },
      actor.userId,
    )
    await actor.app.notebooksDataSource.createNotebook(
      { name: 'AWS Exam', mode: 'campaign' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: '/notebooks?mode=notebook',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const { data } = response.json()
    assert.equal(data.length, 1)
    assert.equal(data[0].id, evergreen.id)
    assert.equal(data[0].mode, 'notebook')
  })

  test('returns 200 isolating notebooks from other users', async (t) => {
    // Arrange
    const owner = await seedUser(t)
    const otherUser = await seedUser(t, { app: owner.app })
    await owner.app.notebooksDataSource.createNotebook({ name: 'Owner Secret NB' }, owner.userId)

    // Act
    const response = await otherUser.app.inject({
      method: 'GET',
      url: '/notebooks',
      headers: { Authorization: `Bearer ${otherUser.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.deepEqual(response.json().data, [])
  })

  test('returns 400 when mode query parameter is outside allowed enum', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: '/notebooks?mode=invalid',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 400 when status query parameter is outside allowed enum', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'GET',
      url: '/notebooks?status=paused',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
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
      url: '/notebooks',
    })

    // Assert
    assert.equal(response.statusCode, 401)
  })
})
