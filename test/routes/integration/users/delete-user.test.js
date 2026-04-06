'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { setup } = require('../../../utils/setup-user')

async function deleteCurrentUser(app, accessToken) {
  return await app.inject({
    method: 'DELETE',
    url: '/users/me',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
}

test('DELETE /users/me 204 - Deletes self', async (t) => {
  // Arrange
  const { app, accessToken } = await setup(t, 'user')

  // Act
  const response = await deleteCurrentUser(app, accessToken)

  // Assert
  assert.strictEqual(response.statusCode, 204)
})

test('GET /users/me 401 - Rejects the stale token after self delete', async (t) => {
  // Arrange
  const { app, accessToken } = await setup(t, 'user')
  const deleteResponse = await deleteCurrentUser(app, accessToken)
  assert.strictEqual(deleteResponse.statusCode, 204)

  // Act
  const meVerify = await app.inject({
    method: 'GET',
    url: '/users/me',
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  assert.strictEqual(meVerify.statusCode, 401)
})

test('DELETE /users/:id 204 - Admin deletes other users', async (t) => {
  // Arrange
  const { app, accessToken: adminToken } = await setup(t, 'admin')
  const { userId } = await setup(t, 'user')

  // Act
  const response = await app.inject({
    method: 'DELETE',
    url: `/users/${userId}`,
    headers: { Authorization: `Bearer ${adminToken}` },
  })

  // Assert
  assert.strictEqual(response.statusCode, 204)
})
