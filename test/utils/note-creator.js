'use strict'

const assert = require('node:assert/strict')
const { randomString } = require('./data-creator')
const { seedUser } = require('./setup-user')

async function createNote(t, noteData = {}, seedOptions = {}) {
  const actor = await seedUser(t, seedOptions)
  const { app, accessToken } = actor

  const defaultNoteData = {
    title: randomString(10),
    body: randomString(20),
    tags: [randomString(5)],
  }

  const payload = { ...defaultNoteData, ...noteData }

  const response = await app.inject({
    method: 'POST',
    url: '/notes',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    payload,
  })

  assert.equal(
    response.statusCode,
    201,
    `Failed to create note: ${response.statusCode} - ${response.payload}`,
  )

  return { note: response.json(), ...actor }
}

module.exports = { createNote }
