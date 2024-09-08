'use strict'

const t = require('tap')
const { setup } = require('../../utils/setup-user')
const { randomUUID } = require('node:crypto')

t.beforeEach(async (t) => {
  const { app, accessToken, refreshToken, userId, username } = await setup(t)
  t.context.app = app
  t.context.accessToken = accessToken
  t.context.refreshToken = refreshToken
  t.context.userId = userId
  t.context.username = username
})

t.test('GET /user-details/:id 200 - Fetch user details by id', async (t) => {
  // Arrange
  const { app, accessToken, refreshToken, userId, username } = t.context

  // Act
  const response = await app.inject({
    method: 'GET',
    url: `/user-details/${userId}`,
    headers: {
      contentType: 'application/json',
    },
    cookies: {
      accessToken: accessToken,
      refreshToken: refreshToken,
    },
  })

  // Log the response for debugging
  console.log('Response:', response.statusCode, response.json())

  // Assert
  t.equal(response.statusCode, 200)
  t.type(response.json(), 'object')
  t.equal(response.json().data.username, username)
})

t.test('GET /user-details/:id 404 - User not found', async (t) => {
  // Arrange
  const { app, accessToken, refreshToken } = t.context
  const nonExistentUserId = randomUUID()

  // Act
  const response = await app.inject({
    method: 'GET',
    url: `/user-details/${nonExistentUserId}`,
    headers: {
      contentType: 'application/json',
    },
    cookies: {
      accessToken: accessToken,
      refreshToken: refreshToken,
    },
  })

  // Assert
  t.equal(response.statusCode, 404)
  t.type(response.json(), 'object')
  t.equal(response.json().error, 'User not found')
})

t.test('GET /user-details/:id 400 - Invalid id format', async (t) => {
  // Arrange
  const { app, accessToken, refreshToken } = t.context
  const invalidUserId = 'invalid-id'

  // Act
  const response = await app.inject({
    method: 'GET',
    url: `/user-details/${invalidUserId}`,
    headers: {
      contentType: 'application/json',
    },
    cookies: {
      accessToken: accessToken,
      refreshToken: refreshToken,
    },
  })

  // Assert
  t.equal(response.statusCode, 400)
  t.type(response.json(), 'object')
  t.equal(response.json().message, 'params/id must match format "uuid"')
})
