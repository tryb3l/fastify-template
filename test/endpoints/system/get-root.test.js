'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { buildApp } = require('../../test-setup')

describe('GET /', () => {
  test('returns 200 with root status payload', async (t) => {
    // Arrange
    const app = await buildApp(t)

    // Act
    const response = await app.inject({
      method: 'GET',
      url: '/',
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.deepEqual(response.json(), { root: true })
  })
})
