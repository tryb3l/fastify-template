'use strict'

const { buildNoteSchemas } = require('../note-contract')

async function noteSchemasLoader(fastify) {
  for (const schema of buildNoteSchemas()) {
    if (!fastify.getSchema(schema.$id)) {
      fastify.addSchema(schema)
      fastify.log.debug(`Note schema added: ${schema.$id}`)
    }
  }

  fastify.log.debug('Note schemas loaded')
}

module.exports = {
  noteSchemasLoader,
}
