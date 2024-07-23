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
        servers: [{ url: 'http://localhost:3000', description: 'development' }],
        tags: [
          { name: 'notes', description: 'Notes related end-points' },
          { name: 'users', description: 'Users related end-points' },
          { name: 'auth', description: 'Auth related end-points' },
          { name: 'infrastructure', description: 'infrastructure related end-points' },
          { name: 'files', description: 'Files related end-points' },
        ],
      },
    })
    await fastify.register(require('@fastify/swagger-ui'), {
      routePrefix: '/docs',
      exposeRoute: fastify.secrets.NODE_ENV !== 'production',
    })
  },
  { dependencies: ['application-config'] },
)
