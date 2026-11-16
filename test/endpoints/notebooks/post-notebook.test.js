'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { seedUser } = require('../../utils/setup-user')

describe('POST /notebooks', () => {
  test('returns 201 and creates an evergreen notebook with defaults and notebook_created audit log', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: '/notebooks',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { name: 'Core Computer Science' },
    })

    // Assert
    assert.equal(response.statusCode, 201)
    const created = response.json().data
    assert.ok(created.id)
    assert.equal(created.name, 'Core Computer Science')
    assert.equal(created.description, '')
    assert.equal(created.mode, 'notebook')
    assert.equal(created.status, 'active')
    assert.equal(created.targetDate, null)

    await actor.app.flushAuditLogs()
    const auditDoc = await actor.app.mongo.db
      .collection('auditLogs')
      .findOne({ action: 'notebook_created', resourceId: created.id })
    assert.ok(auditDoc)
  })

  test('returns 201 and creates a campaign with targetDate, interview starterTemplate folders, and campaign_created audit log', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const targetDate = '2026-12-15T09:00:00.000Z'

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: '/notebooks',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: {
        name: 'Staff Backend Interview',
        description: 'Distributed systems & Node.js internals',
        mode: 'campaign',
        targetDate,
        starterTemplate: 'interview',
      },
    })

    // Assert
    assert.equal(response.statusCode, 201)
    const campaign = response.json().data
    assert.equal(campaign.mode, 'campaign')
    assert.equal(campaign.status, 'active')
    assert.equal(campaign.targetDate, targetDate)
    assert.equal(campaign.description, 'Distributed systems & Node.js internals')

    const folders = await actor.app.notebooksDataSource.listFolders(campaign.id, actor.userId)
    assert.deepEqual(
      folders.map((f) => f.name),
      [
        '01 - Screening & Recruiter',
        '02 - Technical & Coding',
        '03 - System Design & Architecture',
        '04 - Post-Mortems & Debriefs',
      ],
    )

    await actor.app.flushAuditLogs()
    const auditDoc = await actor.app.mongo.db
      .collection('auditLogs')
      .findOne({ action: 'campaign_created', resourceId: campaign.id })
    assert.ok(auditDoc)
  })

  test('returns 201 and creates a campaign with exam starterTemplate folders', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: '/notebooks',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: {
        name: 'AWS Solutions Architect Exam',
        mode: 'campaign',
        starterTemplate: 'exam',
      },
    })

    // Assert
    assert.equal(response.statusCode, 201)
    const campaign = response.json().data
    const folders = await actor.app.notebooksDataSource.listFolders(campaign.id, actor.userId)
    assert.deepEqual(
      folders.map((f) => f.name),
      ['01 - Core Syllabus', '02 - Practice & Mock Problems', '03 - Post-Mortems & Weak Spots'],
    )
  })

  test('returns 201 and seeds custom starterFolders taking precedence over starterTemplate', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: '/notebooks',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: {
        name: 'Custom Stage Campaign',
        mode: 'campaign',
        starterTemplate: 'interview',
        starterFolders: ['Stage A', 'Stage B'],
      },
    })

    // Assert
    assert.equal(response.statusCode, 201)
    const campaign = response.json().data
    const folders = await actor.app.notebooksDataSource.listFolders(campaign.id, actor.userId)
    assert.deepEqual(
      folders.map((f) => f.name),
      ['Stage A', 'Stage B'],
    )
  })

  test('returns 400 when name is missing', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: '/notebooks',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { description: 'Missing name' },
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 400 when name exceeds 100 characters', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: '/notebooks',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { name: 'n'.repeat(101) },
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 400 when description exceeds 500 characters', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: '/notebooks',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: { name: 'Valid Name', description: 'd'.repeat(501) },
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 400 when starterFolders exceeds 10 items', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const starterFolders = Array.from({ length: 11 }, (_, index) => `Folder ${index + 1}`)

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: '/notebooks',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: {
        name: 'Too Many Starter Folders',
        mode: 'campaign',
        starterFolders,
      },
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 400 when mode or starterTemplate is outside allowed enum', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: '/notebooks',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: {
        name: 'Invalid Template',
        mode: 'campaign',
        starterTemplate: 'bootcamp',
      },
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 400 when targetDate is not a valid date-time string', async (t) => {
    // Arrange
    const actor = await seedUser(t)

    // Act
    const response = await actor.app.inject({
      method: 'POST',
      url: '/notebooks',
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      payload: {
        name: 'Malformed Target Date',
        mode: 'campaign',
        targetDate: 'not-a-date',
      },
    })

    // Assert
    assert.equal(response.statusCode, 400)
  })

  test('returns 401 when unauthenticated', async (t) => {
    // Arrange
    const { app } = await seedUser(t)

    // Act
    const response = await app.inject({
      method: 'POST',
      url: '/notebooks',
      payload: { name: 'Unauthorized Notebook' },
    })

    // Assert
    assert.equal(response.statusCode, 401)
  })
})
