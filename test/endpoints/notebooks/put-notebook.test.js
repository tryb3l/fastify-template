'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUIDv7 } = require('node:crypto')
const { seedUser } = require('../../utils/setup-user')

describe('PUT /notebooks/:id', () => {
  test('returns 200 and updates notebook name, description, mode, and targetDate with notebook_updated audit log', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const notebook = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Initial Name', description: 'Initial Desc', mode: 'notebook' },
      actor.userId,
    )
    const nextTargetDate = '2026-10-01T12:00:00.000Z'

    // Act
    const response = await actor.app.inject({
      method: 'PUT',
      url: `/notebooks/${notebook.id}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: {
        name: 'Promoted Campaign',
        description: 'Updated description',
        mode: 'campaign',
        targetDate: nextTargetDate,
      },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const updated = response.json().data
    assert.equal(updated.id, notebook.id)
    assert.equal(updated.name, 'Promoted Campaign')
    assert.equal(updated.description, 'Updated description')
    assert.equal(updated.mode, 'campaign')
    assert.equal(updated.status, 'active')
    assert.equal(updated.targetDate, nextTargetDate)

    await actor.app.flushAuditLogs()
    const auditDoc = await actor.app.mongo.db
      .collection('auditLogs')
      .findOne({ action: 'notebook_updated', resourceId: notebook.id })
    assert.ok(auditDoc)
  })

  test('returns 200 archiving a campaign and writing notebook_archived audit log', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const campaign = await actor.app.notebooksDataSource.createNotebook(
      { name: 'AWS Solutions Architect Exam', mode: 'campaign', status: 'active' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'PUT',
      url: `/notebooks/${campaign.id}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { status: 'archived' },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.equal(response.json().data.status, 'archived')

    await actor.app.flushAuditLogs()
    const auditDoc = await actor.app.mongo.db
      .collection('auditLogs')
      .findOne({ action: 'notebook_archived', resourceId: campaign.id })
    assert.ok(auditDoc)
  })

  test('returns 200 reopening an archived campaign to active and clearing targetDate to null', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const campaign = await actor.app.notebooksDataSource.createNotebook(
      {
        name: 'Reopened Campaign',
        mode: 'campaign',
        status: 'archived',
        targetDate: '2026-12-01T00:00:00.000Z',
      },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'PUT',
      url: `/notebooks/${campaign.id}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { status: 'active', targetDate: null },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.equal(response.json().data.status, 'active')
    assert.equal(response.json().data.targetDate, null)
  })

  test('returns 400 when update payload is empty', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const notebook = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Unchanged NB' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'PUT',
      url: `/notebooks/${notebook.id}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: {},
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 400 when notebook id param is not a valid UUID', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'PUT',
      url: '/notebooks/not-a-uuid',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { name: 'Renamed' },
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 400 when mode or status is outside allowed enum', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const notebook = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Valid NB' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'PUT',
      url: `/notebooks/${notebook.id}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { status: 'deleted' },
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 401 when unauthenticated', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const notebook = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Protected NB' },
      actor.userId,
    )

    // Act
    const response = await actor.app.inject({
      method: 'PUT',
      url: `/notebooks/${notebook.id}`,
      payload: { name: 'Unauthorized Edit' },
    })

    // Assert
    assert.equal(response.statusCode, 401)
  })

  test('returns 404 when notebook does not exist', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'PUT',
      url: `/notebooks/${randomUUIDv7()}`,
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { name: 'Missing NB' },
    })

    // Assert
    assert.equal(response.statusCode, 404)
  })

  test('returns 404 when another user attempts to update the notebook', async (t) => {
    // Arrange
    const owner = await seedUser(t)
    const intruder = await seedUser(t, { app: owner.app })
    const ownerNb = await owner.app.notebooksDataSource.createNotebook(
      { name: 'Owner NB' },
      owner.userId,
    )

    // Act
    const response = await intruder.app.inject({
      method: 'PUT',
      url: `/notebooks/${ownerNb.id}`,
      headers: { Authorization: `Bearer ${intruder.accessToken}` },
      payload: { name: 'Hijacked NB' },
    })

    // Assert
    assert.equal(response.statusCode, 404)
    const persisted = await owner.app.notebooksDataSource.readNotebook(ownerNb.id, owner.userId)
    assert.equal(persisted.name, 'Owner NB')
  })
})
