'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const fastify = require('fastify')
const corsPlugin = require('../../plugins/cors')

const fp = require('fastify-plugin')

async function buildIsolatedApp(t, configOverrides = {}) {
  const app = fastify()
  app.register(
    fp(
      async (fastify) => {
        fastify.decorate('config', {
          FRONTEND_URL: 'http://localhost:5173',
          ...configOverrides,
        })
      },
      { name: 'application-config' },
    ),
  )

  await app.register(corsPlugin)
  app.get('/', () => 'ok')
  app.options('/', () => 'ok')
  await app.ready()
  t.after(() => app.close())
  return app
}

describe('CORS plugin', () => {
  test('exposes specific headers for allowed browser origins', async (t) => {
    // Arrange
    const app = await buildIsolatedApp(t)

    // Act
    const response = await app.inject({
      method: 'GET',
      url: '/',
      headers: {
        Origin: 'http://localhost:5173',
      },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.equal(response.headers['access-control-allow-origin'], 'http://localhost:5173')
    assert.equal(response.headers['access-control-allow-credentials'], 'true')

    const exposedHeaders = response.headers['access-control-expose-headers'].toLowerCase()
    assert.ok(exposedHeaders.includes('x-request-id'))
    assert.ok(exposedHeaders.includes('content-disposition'))
    assert.ok(exposedHeaders.includes('etag'))
    assert.ok(exposedHeaders.includes('content-range'))
    assert.ok(exposedHeaders.includes('accept-ranges'))
    assert.ok(exposedHeaders.includes('content-length'))
  })

  test('handles CORS preflight OPTIONS requests for allowed origins including Range and conditional caching headers', async (t) => {
    // Arrange
    const app = await buildIsolatedApp(t)

    // Act
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers':
          'Content-Type, Authorization, Range, If-None-Match, If-Modified-Since',
      },
    })

    // Assert
    assert.equal(response.statusCode, 204) // fastify-cors intercepts options
    assert.equal(response.headers['access-control-allow-origin'], 'http://localhost:5173')
    assert.equal(response.headers['access-control-allow-methods'], 'GET, POST, PUT, DELETE')
    const allowedHeaders = response.headers['access-control-allow-headers'].toLowerCase()
    assert.ok(allowedHeaders.includes('range'))
    assert.ok(allowedHeaders.includes('if-none-match'))
    assert.ok(allowedHeaders.includes('if-modified-since'))
  })

  test('omits allow-origin header for disallowed browser origins', async (t) => {
    // Arrange
    const app = await buildIsolatedApp(t)

    // Act
    const response = await app.inject({
      method: 'GET',
      url: '/',
      headers: {
        Origin: 'http://disallowed.example.com',
      },
    })

    // Assert
    assert.equal(response.statusCode, 200)
    assert.equal(response.headers['access-control-allow-origin'], undefined)
  })

  test('filters out blank entries from FRONTEND_URL cleanly', async (t) => {
    const app = await buildIsolatedApp(t, {
      FRONTEND_URL: 'http://localhost:5173, , https://app.example.com,',
    })

    const res1 = await app.inject({
      method: 'GET',
      url: '/',
      headers: { Origin: 'http://localhost:5173' },
    })
    assert.equal(res1.headers['access-control-allow-origin'], 'http://localhost:5173')

    const res2 = await app.inject({
      method: 'GET',
      url: '/',
      headers: { Origin: 'https://app.example.com' },
    })
    assert.equal(res2.headers['access-control-allow-origin'], 'https://app.example.com')

    const res3 = await app.inject({
      method: 'GET',
      url: '/',
      headers: { Origin: ' ' },
    })
    assert.equal(res3.headers['access-control-allow-origin'], undefined)

    const res4 = await app.inject({
      method: 'GET',
      url: '/',
      headers: { Origin: '' },
    })
    assert.equal(res4.headers['access-control-allow-origin'], undefined)
  })
})
