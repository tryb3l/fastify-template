'use strict'

const fp = require('fastify-plugin')

module.exports = fp(function (fastify, opts, next) {
  fastify.addHook('onRequest', async (req) => {
    req.log.info({ req }, 'incoming request')
  })

  fastify.addHook('onResponse', async (req, res) => {
    req.log.info({ req, res }, 'request completed')
  })

  fastify.setErrorHandler((err, req, reply) => {
    const statusCode = err.statusCode || reply.statusCode || 500
    const errorResponse = {
      statusCode,
      error: 'Error',
      message: err.message || 'An unexpected error occurred',
      requestId: req.id,
    }

    if (statusCode >= 500) {
      req.log.error({ req, res: reply, err }, err.message)
      errorResponse.message = 'Fatal error. Contact the support team.'
    } else if (statusCode === 429) {
      req.log.warn({ req, res: reply, err }, 'Rate limit exceeded')
      errorResponse.message = 'You hit the rate limit! Slow down please!'
    } else if (statusCode === 400) {
      req.log.info({ req, res: reply, err }, 'Bad request')
      errorResponse.message =
        'The request could not be understood or was missing required parameters'
    } else if (statusCode === 401) {
      req.log.info({ req, res: reply, err }, 'Unauthorized')
      errorResponse.message = 'You are not authorized to access this resource'
    } else if (err.validation) {
      req.log.info({ req, res: reply, err }, 'Validation error')
      errorResponse.message = 'Validation failed'
      errorResponse.error = err.validation
    } else {
      req.log.info({ req, res: reply, err }, err.message)
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

  next()
})
