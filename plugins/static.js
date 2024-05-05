'use strict'

const fp = require('fastify-plugin')
const fastifyStatic = require('@fastify/static')
const path = require('node:path')

module.exports = fp(
  async function staticPlugin(fastify) {
    fastify.register(fastifyStatic, {
      root: path.join(__dirname, '../public'),
      prefix: '/public/',
    })
  },
  {
    name: 'static',
    dependencies: ['application-config'],
  },
)
