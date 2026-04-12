'use strict'

const fp = require('fastify-plugin')

module.exports = fp(
  async function errorHandlerPlugin(fastify, opts) {
    fastify.addHook('onRequest', async (req, reply) => {
      reply.header('x-request-id', req.id)
      req.log.info({ req }, 'incoming request')
    })

    fastify.addHook('onResponse', async (req, reply) => {
      req.log.info({ req, res: reply }, 'request completed')
    })

    fastify.setErrorHandler((err, req, reply) => {
      req.log.error({ req, res: reply, err }, err.message)

      const statusCode = err.statusCode || reply.statusCode || 500

      const errorResponse = {
        statusCode,
        error: err.error || err.name || 'Error',
        message: statusCode < 500 ? err.message : 'An unexpected error occurred',
        requestId: req.id,
      }

      if (statusCode >= 500) {
        errorResponse.message = 'Fatal error. Contact the support team.'
      } else if (statusCode === 429) {
        errorResponse.message = 'You hit the rate limit! Slow down please!'
      } else if (err.validation) {
        errorResponse.message = 'Validation failed'
        errorResponse.details = err.validation
      }

      reply.code(statusCode).send(errorResponse)
    })

    fastify.setNotFoundHandler((req, reply) => {
      req.log.info({ req, res: reply }, 'Route not found')
      reply.code(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'The requested resource could not be found',
        requestId: req.id,
      })
    })
  },
  { name: 'error-handler' },
)
