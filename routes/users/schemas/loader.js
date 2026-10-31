'use strict'

const { buildUserSchemas } = require('../user-contract')

function loadUserSchemas(fastify) {
  fastify.log.debug('Loading users schemas')
  for (const schema of buildUserSchemas()) {
    if (!fastify.getSchema(schema.$id)) {
      fastify.addSchema(schema)
      fastify.log.debug(`User schema added: ${schema.$id}`)
    }
  }
  fastify.log.debug('Users schemas loaded')
}

module.exports = { loadUserSchemas }
