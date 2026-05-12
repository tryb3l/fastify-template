'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { setup } = require('../../../utils/setup-user')

async function deleteUserAsAdmin(adminContext, userId) {
  const response = await adminContext.app.inject({
    method: 'DELETE',
    url: `/users/${userId}`,
    headers: { Authorization: `Bearer ${adminContext.accessToken}` },
  })

  assert.strictEqual(response.statusCode, 204, 'Admin successfully invokes soft-delete')
}

async function issueCsrfContext(app) {
  const csrfResponse = await app.inject({ method: 'GET', url: '/auth/csrf' })

  assert.strictEqual(csrfResponse.statusCode, 200)

  return {
    csrfToken: csrfResponse.json().csrfToken,
    csrfCookieHeader: Array.isArray(csrfResponse.headers['set-cookie'])
      ? csrfResponse.headers['set-cookie'][0]
      : csrfResponse.headers['set-cookie'],
  }
}

test('POST /auth/authenticate 401 - Soft-deleted users cannot log in again', async (t) => {
  // Arrange
  const adminContext = await setup(t, 'admin')
  const userContext = await setup(t, 'user')
  await deleteUserAsAdmin(adminContext, userContext.userId)

  // Act
  const authResponse = await userContext.app.inject({
    method: 'POST',
    url: '/auth/authenticate',
    payload: { username: userContext.username, password: userContext.password },
  })

  // Assert
  assert.strictEqual(
    authResponse.statusCode,
    401,
    'Deleted accounts cannot forge new authentications',
  )
})

test('POST /auth/refresh 401 - Soft-deleted users cannot refresh existing sessions', async (t) => {
  // Arrange
  const adminContext = await setup(t, 'admin')
  const userContext = await setup(t, 'user')
  await deleteUserAsAdmin(adminContext, userContext.userId)

  const { csrfToken, csrfCookieHeader } = await issueCsrfContext(userContext.app)
  const refreshCookie = `refreshToken=${userContext.refreshToken}; ${csrfCookieHeader}`

  // Act
  const refreshResponse = await userContext.app.inject({
    method: 'POST',
    url: '/auth/refresh',
    headers: {
      cookie: refreshCookie,
      'x-csrf-token': csrfToken,
    },
  })
  // Assert
  assert.strictEqual(
    refreshResponse.statusCode,
    401,
    'Deleted accounts cannot rotate existing ghost sessions natively',
  )
})
