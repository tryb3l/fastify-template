'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { createNote } = require('../../../utils/note-creator')

test('Rate Limiting - Blocks authenticated user after exceeding max requests', async (t) => {
  // Arrange
  const { app, accessToken } = await createNote(t)

  // Act: Spam the API up to the test limit (5 requests)
  for (let i = 0; i < 5; i++) {
    const res = await app.inject({
      method: 'GET',
      url: '/notes',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    assert.strictEqual(res.statusCode, 200, `Request ${i + 1} should pass`)
  }

  // Act: 6-th request should be blocked
  const blockedResponse = await app.inject({
    method: 'GET',
    url: '/notes',
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Assert
  assert.strictEqual(blockedResponse.statusCode, 429)

  const payload = blockedResponse.json()
  assert.strictEqual(payload.error, 'Too Many Requests')
  assert.ok(
    payload.message.includes('Slow down please!'),
    'Should return the custom rate limit message',
  )
})
