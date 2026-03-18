'use strict'

module.exports = async function infrastructure(fastify) {
  fastify.route({
    method: 'GET',
    url: '/health',
    config: {
      rateLimit: {
        max: 30,
        timeWindow: '1 minute'
      }
    },
    schema: {
      tags: ['infrastructure'],
      summary: 'Health check',
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
          },
        },
      },
    },
    handler: async function healthHandler(request, reply) {
      return { status: 'ok' }
    },
  })

  fastify.route({
    method: 'GET',
    url: '/ready',
    config: {
      rateLimit: {
        max: 30, 
        timeWindow: '1 minute'
      }
    },
    schema: {
      tags: ['infrastructure'],
      summary: 'Readiness check',
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
          },
        },
      },
    },
    handler: async function readyHandler(request, reply) {
      return { status: 'ok' }
    },
  })
}