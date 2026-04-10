'use strict'

const fp = require('fastify-plugin')
const rateLimit = require('@fastify/rate-limit')

function extractAccessToken(request) {
  if (request.headers.authorization?.startsWith('Bearer ')) {
    return request.headers.authorization.substring(7)
  }

  return request.cookies?.accessToken
}

module.exports = fp(
  async function rateLimitPlugin(fastify, opts) {
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

        const token = extractAccessToken(request)
        if (token) {
          try {
            const decoded = await fastify.jwt.verify(token)
            if (decoded?.sub) {
              return `user:${decoded.sub}`
            }
          } catch (err) {
            request.log.debug(
              { err },
              'Falling back to IP rate-limit key after token verification failed',
            )
          }
        }

        return `ip:${request.ip}`
      },
    })

    fastify.log.info('Successfully registered rate-limit plugin')
  },
  {
    name: 'rate-limit',
    dependencies: ['application-config'],
    decorators: {
      fastify: ['config', 'jwt'],
    },
  },
)
