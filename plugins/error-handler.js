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
    if (reply.statusCode >= 500) {
      req.log.error({ req, res: reply, err: err }, err?.message)
      reply.send(`Fatal error. Contact the support team. Id${req.id}`)
      return
    }
    if (err.statusCode === 429) {
      reply.code(429).send('You hit the rate limit! Slow down please!')
      return
    }
    if (reply.statusCode === 400) {
      req.log.info({ req, res: reply, err: err }, 'Bad request')
      reply.code(400).send({
        error: 'Bad Request',
        message: 'The request could not be understood or was missing required parameters',
      })
      return
    }
    if (reply.statusCode === 401) {
      req.log.info({ req, res: reply, err: err }, 'Unauthorized')
      reply.code(401).send({
        error: 'Unauthorized',
        message: 'You are not authorized to access this resource',
      })
      return
    }
    req.log.info({ req, res: reply, err: err }, err?.message)
    reply.send(err)
  })
  fastify.setNotFoundHandler((req, reply) => {
    req.log.info({ req, res: reply }, 'Route not found')
    reply.code(404).send({
      error: 'Not Found',
      message: 'The requested resource could not be found',
    })
  })
  next()
})
