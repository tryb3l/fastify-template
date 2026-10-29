'use strict'

const test = require('node:test')
const assert = require('node:assert')
const https = require('node:https')
const { buildApp } = require('../../../test-setup')

test('GET /infrastructure/ready 200 - Returns OK without authentication', async (t) => {
  // Arrange
  const app = await buildApp(t)

  // Act
  const response = await app.inject({
    method: 'GET',
    url: '/infrastructure/ready',
  })

  // Assert
  assert.strictEqual(response.statusCode, 200)
  assert.deepStrictEqual(response.json(), { status: 'ok' })
})

test('GET /docs/json over HTTPS when local certificates are present', async (t) => {
  const app = await buildApp(t)
  if (!app.initialConfig?.https) {
    t.skip('Local HTTPS certificates (.certs/) not present')
    return
  }

  await app.listen({ port: 0, host: '127.0.0.1' })
  const port = app.server.address().port

  const result = await new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/docs/json',
        method: 'GET',
        rejectUnauthorized: false,
      },
      (res) => {
        const encrypted = Boolean(res.socket?.encrypted)
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            encrypted,
            body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
          })
        })
      },
    )
    req.on('error', reject)
    req.end()
  })

  assert.strictEqual(result.statusCode, 200)
  assert.strictEqual(result.encrypted, true)
  assert.strictEqual(result.body.info.title, 'Notes App API')
})
