'use strict'
const fp = require('fastify-plugin')

module.exports = fp(
  async function swaggerPlugin(fastify) {
    await fastify.register(require('@fastify/swagger'), {
      swagger: {
        info: {
          title: 'Notes app',
          description: 'Fastify CRUD application example',
          version: require('../package.json').version,
        },
      },
    })
    await fastify.register(require('@fastify/swagger-ui'), {
      routePrefix: '/docs',
      exposeRoute: fastify.secrets.NODE_ENV !== 'production',
    })
  },
  { dependencies: ['application-config'] },
)
