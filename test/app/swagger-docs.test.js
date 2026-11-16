'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const https = require('node:https')
const Fastify = require('fastify')

const configPlugin = require('../../plugins/config')
const swaggerPlugin = require('../../plugins/swagger')
const { buildApp } = require('../test-setup')

describe('Swagger OpenAPI documentation', () => {
  test('serves OpenAPI specification JSON at GET /docs/json with bearerAuth scheme', async (t) => {
    // Arrange
    const app = await buildApp(t)

    // Act
    const response = await app.inject({
      method: 'GET',
      url: '/docs/json',
    })

    // Assert
    assert.equal(response.statusCode, 200)
    const spec = response.json()
    assert.equal(spec.info.title, 'Notes App API')
    assert.ok(spec.components?.securitySchemes?.bearerAuth)
    assert.ok(Object.keys(spec.paths || {}).length > 0)
  })

  test('serves GET /docs/json over HTTPS when local TLS certificates are present', async (t) => {
    // Arrange
    const app = await buildApp(t)
    if (!app.initialConfig?.https) {
      t.skip('Local HTTPS certificates (.certs/) not present')
      return
    }

    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = app.server.address().port

    // Act
    const result = await new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/docs/json',
          method: 'GET',
          agent: false,
          rejectUnauthorized: false,
        },
        (res) => {
          const encrypted = Boolean(res.socket?.encrypted)
          const chunks = []
          res.once('error', reject)
          res.on('data', (chunk) => chunks.push(chunk))
          res.on('end', () => {
            try {
              resolve({
                statusCode: res.statusCode,
                encrypted,
                body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
              })
            } catch (err) {
              reject(err)
            }
          })
        },
      )
      req.once('error', reject)
      req.end()
    })

    // Assert
    assert.equal(result.statusCode, 200)
    assert.equal(result.encrypted, true)
    assert.equal(result.body.info.title, 'Notes App API')
  })

  test('omits Swagger UI /docs route in production mode', async (t) => {
    // Arrange
    const app = Fastify({ logger: false })
    t.after(async () => {
      await app.close()
    })

    await app.register(configPlugin, {
      configData: {
        MONGO_URL: 'mongodb://localhost:27017/test',
        NODE_ENV: 'production',
        JWT_SECRET: 'secret-11111111',
        COOKIE_SECRET: 'cookie-secret-11111111',
        FRONTEND_URL: 'http://localhost:5173',
      },
    })
    await app.register(swaggerPlugin)

    // Act
    const response = await app.inject({
      method: 'GET',
      url: '/docs',
    })

    // Assert
    assert.equal(response.statusCode, 404)
  })
})
