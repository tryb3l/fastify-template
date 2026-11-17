'use strict'

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const https = require('node:https')
const os = require('node:os')
const path = require('node:path')
const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const Fastify = require('fastify')

const { resolveHttpsOptions } = require('../../configs/server-options')
const configPlugin = require('../../plugins/config')
const swaggerPlugin = require('../../plugins/swagger')
const { buildApp } = require('../test-setup')

function createEphemeralHttpsOptions(t) {
  const certDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fastify-https-test-'))
  t.after(() => {
    fs.rmSync(certDir, { recursive: true, force: true })
  })

  const keyPath = path.join(certDir, 'localhost-key.pem')
  const certPath = path.join(certDir, 'localhost.pem')
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-sha256',
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
      '-keyout',
      keyPath,
      '-out',
      certPath,
    ],
    { stdio: 'ignore' },
  )

  return resolveHttpsOptions({
    NODE_ENV: 'test',
    HTTPS_KEY_PATH: keyPath,
    HTTPS_CERT_PATH: certPath,
  })
}

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

  test('serves GET /docs/json over HTTPS when TLS certificates are configured', async (t) => {
    // Arrange
    const httpsOptions = createEphemeralHttpsOptions(t)
    const app = await buildApp(t, undefined, { https: httpsOptions })
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
