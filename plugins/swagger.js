'use strict'

const fp = require('fastify-plugin')

module.exports = fp(
  async function swaggerPlugin(fastify) {
    fastify.log.info('Starting registration of swagger plugin')

    try {
      await fastify.register(require('@fastify/swagger'), {
        openapi: {
          info: {
            title: 'Notes App API',
            description: 'API documentation for the Fastify Notes boilerplate',
            version: '1.0.0',
          },
          servers: [{ url: '/', description: 'Current Environment' }],
          tags: [
            { name: 'notes', description: 'Notes related end-points' },
            { name: 'users', description: 'Users related end-points' },
            { name: 'auth', description: 'Auth related end-points' },
            { name: 'files', description: 'Files related end-points' },
            { name: 'infrastructure', description: 'Infrastructure and Health checks' },
          ],
          components: {
            securitySchemes: {
              bearerAuth: {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'JWT',
                description: 'Enter your JWT token here to authorize protected requests.',
              },
            },
          },
          security: [{ bearerAuth: [] }],
        },
      })
      fastify.log.info('Successfully registered @fastify/swagger')

      if (fastify.config?.NODE_ENV !== 'production') {
        await fastify.register(require('@fastify/swagger-ui'), {
          routePrefix: '/docs',
          uiConfig: {
            docExpansion: 'list',
            deepLinking: false,
          },
        })
        fastify.log.info('Successfully registered @fastify/swagger-ui')
      }
    } catch (err) {
      fastify.log.error({ err }, 'Error registering swagger plugin')
      throw err
    }
  },
  {
    dependencies: ['application-config'],
    name: 'swagger-plugin',
    decorators: { fastify: ['config'] }
  }
)