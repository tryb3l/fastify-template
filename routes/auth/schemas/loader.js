'use strict'

const { buildAuthSchemas } = require('../auth-contract')

async function authSchemasLoader(fastify) {
  fastify.log.debug('Loading auth schemas')
  for (const schema of buildAuthSchemas()) {
    if (!fastify.getSchema(schema.$id)) {
      await fastify.addSchema(schema)
      fastify.log.debug(`Auth schema added: ${schema.$id}`)
    }
  }
  fastify.log.debug('Auth schemas loaded')
}

module.exports = { authSchemasLoader }
