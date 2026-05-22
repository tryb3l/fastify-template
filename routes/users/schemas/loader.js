'use strict'

function loadUserSchemas(fastify) {
  fastify.log.debug('Loading users schemas')
  const schemas = [
    './read-params.json',
    './update-user.json',
    './update-admin-user.json',
    './users-list-query.json',
    './users-list-response.json',
  ]
  for (const schemaPath of schemas) {
    const schema = require(schemaPath)
    fastify.addSchema(schema)
    fastify.log.debug(`User schema added: ${schema.$id}`)
  }
  fastify.log.debug('Users schemas loaded')
}

module.exports = { loadUserSchemas }
