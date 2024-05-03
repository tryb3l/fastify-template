'use strict'
const fp = require('fastify-plugin')

module.exports = fp(async function rateLimitPlugin(fastify) {
  fastify.register(require('@fastify/rate-limit'), {
    max: 150,
    timeWindow: '1 minute',
  })
})
