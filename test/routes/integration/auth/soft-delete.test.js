'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { setup } = require('../../../utils/setup-user')

test('Auth Lifecycle Safety - Soft Deleted entities permanently lose access', async (t) => {
  // Arrange
  const adminContext = await setup(t, 'admin')
  const userContext = await setup(t, 'user')
  
  // Act (Admin deletes user)
  const deleteResponse = await adminContext.app.inject({
    method: 'DELETE',
    url: `/users/${userContext.userId}`,
    headers: { Authorization: `Bearer ${adminContext.accessToken}` }
  })
  assert.strictEqual(deleteResponse.statusCode, 204, 'Admin successfully invokes soft-delete')

  // Act (Authenticate on deleted object)
  const authResponse = await userContext.app.inject({
    method: 'POST',
    url: '/auth/authenticate',
    payload: { username: userContext.username, password: userContext.password }
  })
  // Assert
  assert.strictEqual(authResponse.statusCode, 401, 'Deleted accounts cannot forge new authentications')

  // Act (Refresh old payload)
  const csrfResponse = await userContext.app.inject({ method: 'GET', url: '/auth/csrf' })
  const csrfToken = csrfResponse.json().csrfToken
  const csrfCookie = csrfResponse.headers['set-cookie']
  const refreshCookie = `refreshToken=${userContext.refreshToken}; ${Array.isArray(csrfCookie) ? csrfCookie[0] : csrfCookie}`

  const refreshResponse = await userContext.app.inject({
    method: 'POST',
    url: '/auth/refresh',
    headers: {
      cookie: refreshCookie,
      'x-csrf-token': csrfToken
    }
  })
  
  // Assert
  assert.strictEqual(refreshResponse.statusCode, 401, 'Deleted accounts cannot rotate existing ghost sessions natively')
})
