'use strict'
const fp = require('fastify-plugin')
const helmet = require('@fastify/helmet')

module.exports = fp(
  async function helmetPlugin(fastify) {
    await fastify.register(helmet)
  },
  { name: 'helmet-plugin' },
)
