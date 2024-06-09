'use strict'

const fp = require('fastify-plugin')

module.exports = fp(async function schemaLoaderPlugin(fastify) {
  fastify.addSchema(require('./register.json'))
  fastify.addSchema(require('./authenticate.json'))
  fastify.addSchema(require('./token-header.json'))
  fastify.addSchema(require('./token.json'))
  fastify.addSchema(require('./user.json'))
  fastify.addSchema(require('./email.json'))
  fastify.addSchema(require('./password.json'))
  fastify.addSchema(require('./username.json'))
  fastify.addSchema(require('./firstname.json'))
  fastify.addSchema(require('./lastname.json'))
})
