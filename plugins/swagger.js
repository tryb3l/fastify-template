'use strict'
const fp = require('fastify-plugin')

module.exports = fp(
  async function swaggerPlugin(fastify) {
    fastify.log.info('Starting registration of swagger plugin')

    try {
      await fastify.register(require('@fastify/swagger'), {
        swagger: {
          info: {
            title: 'Notes app',
            description: 'Notes app API documentation',
            version: '1.0.0',
          },
          servers: [{ url: 'http://localhost:3000', description: 'development' }],
          tags: [
            { name: 'notes', description: 'Notes related end-points' },
            { name: 'users', description: 'Users related end-points' },
            { name: 'auth', description: 'Auth related end-points' },
            { name: 'infrastructure', description: 'infrastructure related end-points' },
            { name: 'files', description: 'Files related end-points' },
          ],
          securityDefinitions: {
            bearerAuth: {
              type: 'apiKey',
              name: 'Authorization',
              in: 'header',
              description: 'Enter your token in the format: **Bearer &lt;token&gt;**',
            },
          },
          security: [
            { bearerAuth: [] }
          ],
        },
      })
      fastify.log.info('Successfully registered @fastify/swagger')

      if (fastify.secrets.NODE_ENV !== 'production') {
        await fastify.register(require('@fastify/swagger-ui'), {
          routePrefix: '/docs',
        })
        fastify.log.info('Successfully registered @fastify/swagger-ui')
      }
    } catch (err) {
      fastify.log.error('Error registering swagger plugin:', err)
      throw err
    }

    fastify.log.info('Successfully registered swagger plugin')
  },
  { dependencies: ['application-config'], name: 'swagger-plugin' },
)