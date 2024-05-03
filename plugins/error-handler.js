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
    }
    req.log.info({ req, res: reply, err: err }, err?.message)
    reply.send(err)
  })
  next()
})
