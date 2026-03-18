'use strict'
const fp = require('fastify-plugin')
const fastifyRateLimit = require('@fastify/rate-limit')

module.exports = fp(async function rateLimitPlugin(fastify) {
  
  await fastify.register(fastifyRateLimit, {
    max: 150,
    timeWindow: '1 minute',
  })
}, { name: 'rate-limit-plugin' })