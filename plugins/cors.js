'use strict'

const fp = require('fastify-plugin')
const fastifyCors = require('@fastify/cors')

module.exports = fp(
  async function corsPlugin(fastify) {
    fastify.log.info('Starting registration of cors plugin')

    const allowedOrigins = fastify.config.FRONTEND_URL.split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    await fastify.register(fastifyCors, {
      origin: allowedOrigins,
      credentials: true,
      exposedHeaders: [
        'x-request-id',
        'Content-Disposition',
        'ETag',
        'Content-Range',
        'Accept-Ranges',
        'Content-Length',
      ],
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'csrf-token',
        'x-csrf-token',
        'xsrf-token',
        'x-xsrf-token',
      ],
    })

    fastify.log.info('Successfully registered cors plugin')
  },
  {
    name: 'cors-plugin',
    dependencies: ['application-config'],
    decorators: { fastify: ['config'] },
  },
)
