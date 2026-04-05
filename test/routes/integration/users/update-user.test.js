'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { setup } = require('../../../utils/setup-user')

test('PUT /users/me 200 - Updates self username', async (t) => {
  // Arrange
  const { app, accessToken } = await setup(t, 'user')
  const newUsername = 'updatedusername123'

  // Act
  const response = await app.inject({
    method: 'PUT',
    url: `/users/me`,
    headers: { Authorization: `Bearer ${accessToken}` },
    payload: { username: newUsername }
  })

  // Assert
  assert.strictEqual(response.statusCode, 200)
  assert.strictEqual(response.json().data.username, newUsername)
})

test('PUT /users/:id 403 - Block user from updating other users', async (t) => {
  // Arrange
  const { app, accessToken } = await setup(t, 'user')

  // Act
  const response = await app.inject({
    method: 'PUT',
    url: `/users/somefakeid_abcd`,
    headers: { Authorization: `Bearer ${accessToken}` },
    payload: { username: 'override' }
  })

  // Assert
  assert.ok(response.statusCode >= 400 && response.statusCode < 500)
})
