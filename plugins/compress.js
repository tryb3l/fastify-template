'use strict'

const fp = require('fastify-plugin')
const fastifyCompress = require('@fastify/compress')

module.exports = fp(
  async function compressPlugin(fastify) {
    fastify.log.info("Registering 'compress' plugin")

    await fastify.register(fastifyCompress, {
      global: true,
      threshold: 1024,
      encodings: ['br', 'gzip', 'deflate'],
    })

    fastify.log.info("Successfully registered 'compress' plugin")
  },
  {
    name: 'compress-plugin',
    dependencies: ['application-config'],
    decorators: { fastify: ['config'] },
  },
)
