'use strict'

const { randomString } = require('./data-creator')
const { setup } = require('./setup-user')

async function createNote(t, noteData = {}) {
  const { app, accessToken, refreshToken } = await setup(t)

  const defaultNoteData = {
    title: randomString(10),
    body: randomString(20),
    tags: [randomString(5)],
  }

  const payload = { ...defaultNoteData, ...noteData }

  const response = await app.inject({
    method: 'POST',
    url: '/notes/',
    headers: {
      'Content-Type': 'application/json',
    },
    cookies: {
      accessToken: accessToken,
      refreshToken: refreshToken,
    },
    payload: payload,
  })

  if (response.statusCode !== 201) {
    throw new Error(`Failed to create note: ${response.statusCode} ${response.body}`)
  }

  return { note: response.json(), app, accessToken, refreshToken }
}

module.exports = { createNote }
