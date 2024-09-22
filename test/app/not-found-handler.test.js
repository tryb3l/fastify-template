'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { buildApp } = require('../helper')

test.skip('should call the notFoundHandler when no route is found', async (t) => {
  // Arrange
  const app = await buildApp(t)

  // Act
  const response = await app.inject({
    method: 'GET',
    url: '/not-found',
  })

  // Assert
  assert.strictEqual(response.statusCode, 404)
  assert.strictEqual(response.json().message, 'Not Found')
})

test.skip('should be rate limited', async (t) => {
  const app = await buildApp(t)

  for (let i = 0; i < 3; i++) {
    const res = await app.inject({
      method: 'GET',
      url: '/this-route-does-not-exist',
    })

    assert.strictEqual(res.statusCode, 404)
  }

  const res = await app.inject({
    method: 'GET',
    url: '/this-route-does-not-exist',
  })

  assert.strictEqual(res.statusCode, 429)
})
