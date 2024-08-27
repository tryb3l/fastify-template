'use strict'

const t = require('tap')
const { setup } = require('../../utils/setup-user')
const { randomString } = require('../../utils/data-creator')

t.beforeEach(async (t) => {
  const { app, accessToken, refreshToken } = await setup(t)
  t.context.app = app
  t.context.accessToken = accessToken
  t.context.refreshToken = refreshToken
})

const noteTitle = randomString(10)
const noteBody = randomString(20)
const noteTags = [randomString(5)]

t.test('POST /notes 201', async (t) => {
  // Arrange
  const { app, accessToken, refreshToken } = t.context

  // Act
  const response = await app.inject({
    method: 'POST',
    url: '/notes/',
    headers: {
      contentType: 'application/json',
    },
    cookies: {
      accessToken: accessToken,
      refreshToken: refreshToken,
    },
    payload: {
      title: noteTitle,
      body: noteBody,
      tags: noteTags,
    },
  })

  // Assert
  t.equal(response.statusCode, 201)
  t.type(response.json(), 'object')
  t.ok(response.json().id)
  t.equal(typeof response.json().id, 'string')
})
