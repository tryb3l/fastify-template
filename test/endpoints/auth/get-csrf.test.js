'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { buildApp } = require('../../test-setup')
const { getCookiePair } = require('../../utils/csrf')

describe('GET /auth/csrf', () => {
  test('returns 200 with csrfToken and _csrf cookie', async (t) => {
    // Arrange
    const app = await buildApp(t)

    // Act
    const response = await app.inject({
      method: 'GET',
      url: '/auth/csrf',
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const body = response.json()
    assert.equal(typeof body.csrfToken, 'string')
    assert.ok(body.csrfToken.length > 0)
    assert.ok(getCookiePair(response.headers['set-cookie']))
  })
})
