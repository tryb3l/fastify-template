'use strict'

const fp = require('fastify-plugin')
const rateLimit = require('@fastify/rate-limit')

module.exports = fp(
  async function rateLimitPlugin(fastify) {
    fastify.log.info('Starting registration of rate-limit plugin')

    await fastify.register(rateLimit, {
      global: false,
      max: 100,
      timeWindow: '1 minute',
      hook: 'preHandler',

      errorResponseBuilder: function (request, context) {
        return {
          statusCode: 429,
          error: 'Too Many Requests',
          message: `You hit the rate limit! Slow down please! Limit: ${context.max}, TTL: ${context.ttl}`,
          requestId: request.id,
        }
      },

      keyGenerator: async function (request) {
        if (request.user && (request.user._id || request.user.id)) {
          return `user:${request.user._id || request.user.id}`
        }

        return `ip:${request.ip}`
      },
    })

    fastify.log.info('Successfully registered rate-limit plugin')
  },
  {
    name: 'rate-limit',
    dependencies: ['application-config', 'authentication-plugin'],
    decorators: {
      fastify: ['config'],
    },
  },
)
