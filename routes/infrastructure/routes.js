'use strict'

const fp = require('fastify-plugin')

module.exports = fp(async function infrastructure(fastify) {
  fastify.route({
    method: 'GET',
    url: '/health',
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
      reply.code(200)
      return { status: 'ok' }
    },
  })

  fastify.route({
    method: 'GET',
    url: '/ready',
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
      reply.code(200)
      return { status: 'ok' }
    },
  })
})
