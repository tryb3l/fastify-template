'use strict'
const fp = require('fastify-plugin')
const helmet = require('@fastify/helmet')

module.exports = fp(
  async function helmetPlugin(fastify, opts) {
    await fastify.register(helmet)
  },
  { name: 'helmet-plugin' },
)
