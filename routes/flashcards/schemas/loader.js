'use strict'

const { buildFlashcardSchemas } = require('../flashcard-contract')

function loadFlashcardSchemas(fastify) {
  for (const schema of buildFlashcardSchemas()) {
    if (!fastify.getSchema(schema.$id)) {
      fastify.addSchema(schema)
    }
  }
}

module.exports = {
  loadFlashcardSchemas,
}
