'use strict'

const t = require('tap')
const { setup } = require('../../../utils/setup-user')
const { randomString } = require('../../../utils/data-creator')

const noteTitle = randomString(10)
const noteBody = randomString(20)
const noteTags = [randomString(5)]

t.beforeEach(async (t) => {
  const { app, accessToken, refreshToken } = await setup(t)
  t.context.app = app
  t.context.accessToken = accessToken
  t.context.refreshToken = refreshToken
})

t.skip('GET by id /notes 201', async (t) => {
  //Create note
  // Arrange
  const { app, accessToken, refreshToken } = t.context
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
  t.equal(response.statusCode, 201)
  t.type(response.json(), 'object')
  t.ok(response.json().id)
  t.equal(typeof response.json().id, 'string')

  console.log(response.json().id + ' ID!!!!!!!!!')
  // Act
  const responseGet = await app.inject({
    method: 'GET',
    url: `/notes/${response.json().id}`,
    headers: {
      contentType: 'application/json',
    },
    cookies: {
      accessToken: accessToken,
      refreshToken: refreshToken,
    },
  })

  // Assert
  t.equal(responseGet.statusCode, 201)
  t.type(responseGet.json(), 'object')
  t.equal(responseGet.json().id, response.json().id)
})
