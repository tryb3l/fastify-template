'use strict'

const { buildNoteSchemas } = require('../note-contract')

async function noteSchemasLoader(fastify) {
  const sharedSchemas = ['../../../schemas/limit.json', '../../../schemas/skip.json']

  for (const schema of buildNoteSchemas()) {
    if (!fastify.getSchema(schema.$id)) {
      fastify.addSchema(schema)
      fastify.log.debug(`Note schema added: ${schema.$id}`)
    }
  }

  for (const schemaPath of sharedSchemas) {
    const schema = require(schemaPath)
    if (!fastify.getSchema(schema.$id)) {
      fastify.addSchema(schema)
      fastify.log.debug(`Shared schema added: ${schema.$id}`)
    }
  }

  fastify.log.debug('Note schemas loaded')
}

module.exports = {
  noteSchemasLoader,
}
