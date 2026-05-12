'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { setup } = require('../../../../utils/setup-user')
const { randomString } = require('../../../../utils/data-creator')
const { buildMarkdownNote } = require('../../../../utils/markdown-note')

test('POST /notes 201 - User can create a note', async (t) => {
  // Arrange
  const { app, accessToken } = await setup(t, 'user')
  const noteTitle = randomString(10)
  const noteBody = randomString(20)
  const noteTags = [randomString(5)]

  // Act
  const response = await app.inject({
    method: 'POST',
    url: '/notes',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    payload: {
      title: noteTitle,
      body: noteBody,
      tags: noteTags,
    },
  })

  // Assert
  assert.strictEqual(response.statusCode, 201)
  const payload = response.json()
  assert.strictEqual(typeof payload, 'object')
  assert.ok(payload.data.id)
  assert.strictEqual(payload.data.title, noteTitle)
  assert.strictEqual(payload.data.body, noteBody)
  assert.deepStrictEqual(payload.data.tags, noteTags)
})

test('POST /notes 201 - User can create a large markdown note', async (t) => {
  // Arrange
  const { app, accessToken } = await setup(t, 'user')
  const noteTitle = 'Milkdown draft'
  const noteBody = buildMarkdownNote({ minLength: 32000 })
  const noteTags = ['markdown', 'draft']

  // Act
  const response = await app.inject({
    method: 'POST',
    url: '/notes',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    payload: {
      title: noteTitle,
      body: noteBody,
      tags: noteTags,
    },
  })

  // Assert
  assert.strictEqual(response.statusCode, 201)
  const payload = response.json()
  assert.strictEqual(payload.data.title, noteTitle)
  assert.strictEqual(payload.data.body, noteBody)
  assert.deepStrictEqual(payload.data.tags, noteTags)
  assert.ok(payload.data.body.length >= 32000)
})

test('POST /notes 201 - Accepts a note body at the 50000 character limit', async (t) => {
  // Arrange
  const { app, accessToken } = await setup(t, 'user')
  const noteBody = 'b'.repeat(50000)

  // Act
  const response = await app.inject({
    method: 'POST',
    url: '/notes',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    payload: {
      title: 'Boundary body accepted',
      body: noteBody,
      tags: ['boundary', 'accepted'],
    },
  })

  // Assert
  assert.strictEqual(response.statusCode, 201)
  assert.strictEqual(response.json().data.body, noteBody)
})

test('POST /notes 400 - Rejects a note body above the 50000 character limit', async (t) => {
  // Arrange
  const { app, accessToken } = await setup(t, 'user')

  // Act
  const response = await app.inject({
    method: 'POST',
    url: '/notes',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    payload: {
      title: 'Boundary body rejected',
      body: 'b'.repeat(50001),
      tags: ['boundary', 'rejected'],
    },
  })

  // Assert
  assert.strictEqual(response.statusCode, 400)
})

test('POST /notes 400 - Missing title', async (t) => {
  // Arrange
  const { app, accessToken } = await setup(t, 'user')

  // Act
  const response = await app.inject({
    method: 'POST',
    url: '/notes',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    payload: {
      body: 'Some body text',
      tags: ['tag1'],
      // title is omitted
    },
  })

  // Assert
  assert.strictEqual(response.statusCode, 400)

  const responseBody = response.json()
  assert.ok(responseBody.error || responseBody.message, 'Should return an error payload')
})

test('POST /notes 201 - Missing body defaults to an empty string', async (t) => {
  // Arrange
  const { app, accessToken } = await setup(t, 'user')

  // Act
  const response = await app.inject({
    method: 'POST',
    url: '/notes',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    payload: {
      title: 'Valid Title',
      tags: ['tag1'],
      // body is omitted
    },
  })

  // Assert
  assert.strictEqual(response.statusCode, 201)

  const responseBody = response.json()
  assert.strictEqual(responseBody.data.title, 'Valid Title')
  assert.strictEqual(responseBody.data.body, '')
  assert.deepStrictEqual(responseBody.data.tags, ['tag1'])
})

test('POST /notes 201 - Accepts an explicitly empty body', async (t) => {
  // Arrange
  const { app, accessToken } = await setup(t, 'user')

  // Act
  const response = await app.inject({
    method: 'POST',
    url: '/notes',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    payload: {
      title: 'Title Only Stub',
      body: '',
      tags: ['stub'],
    },
  })

  // Assert
  assert.strictEqual(response.statusCode, 201)

  const responseBody = response.json()
  assert.strictEqual(responseBody.data.title, 'Title Only Stub')
  assert.strictEqual(responseBody.data.body, '')
  assert.deepStrictEqual(responseBody.data.tags, ['stub'])
})

test('POST /notes 401 - Unauthorized', async (t) => {
  // Arrange
  const { app } = await setup(t, 'user')

  // Act
  const response = await app.inject({
    method: 'POST',
    url: '/notes',
    headers: { 'Content-Type': 'application/json' },
    payload: {
      title: 'Unauthorized Note',
      body: 'Should not exist',
    },
  })

  // Assert
  assert.strictEqual(response.statusCode, 401)
})
