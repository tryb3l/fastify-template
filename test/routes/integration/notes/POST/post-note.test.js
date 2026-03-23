'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { setup } = require('../../../../utils/setup-user')
const { randomString } = require('../../../../utils/data-creator')

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
  const body = response.json()
  assert.strictEqual(typeof body, 'object')
  assert.ok(body.data.id)
  assert.strictEqual(body.data.title, noteTitle)
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
      tags: ['tag1']
      // title is omitted
    },
  })

  // Assert
  assert.strictEqual(response.statusCode, 400)

  const responseBody = response.json()
  assert.ok(responseBody.error || responseBody.message, 'Should return an error payload')
})

test('POST /notes 400 - Missing body', async (t) => {
  // Arrange
  const { app, accessToken } = await setup(t, 'user')

  // Act
  const response = await app.inject({
    method: 'POST',
    url: '/notes',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    payload: {
      title: 'Valid Title',
      tags: ['tag1']
      // body is omitted
    },
  })

  // Assert
  assert.strictEqual(response.statusCode, 400)

  const responseBody = response.json()
  assert.ok(responseBody.error || responseBody.message, 'Should return an error payload')
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