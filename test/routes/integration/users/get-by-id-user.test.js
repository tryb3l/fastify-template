'use strict'

const t = require('tap')
const { setup } = require('../../../utils/setup-user')
const { randomUUID } = require('node:crypto')

t.test('GET /user-details/:id - Admin can fetch user details', async (t) => {
  const { app, accessToken, userId, username } = await setup(t, 'admin')

  const response = await app.inject({
    method: 'GET',
    url: `/user-details/${userId}`,
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  t.equal(response.statusCode, 200)
  t.type(response.json(), 'object')
  t.equal(response.json().data.username, username)
})

t.skip('GET /user-details/:id 404 - User not found', async (t) => {
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
})

t.skip('GET /user-details/:id 400 - Invalid id format', async (t) => {
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
})

t.test('GET /user-details/:id - Regular user receives 403 Forbidden', async (t) => {
  const { app, accessToken, userId } = await setup(t, 'user')

  const response = await app.inject({
    method: 'GET',
    url: `/user-details/${userId}`,
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  t.equal(response.statusCode, 403)
  t.same(response.json(), {
    statusCode: 403,
    error: 'Forbidden',
    message: 'Insufficient permissions',
  })
})
