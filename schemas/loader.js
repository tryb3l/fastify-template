'use strict'

const fp = require('fastify-plugin')
const { authSchemasLoader } = require('../routes/auth/schemas/loader')
const { noteSchemasLoader } = require('../routes/notes/schemas/loader')
const { loadUserSchemas } = require('../routes/users/schemas/loader')

module.exports = fp(
  async function applicationSchemasPlugin(fastify) {
    await authSchemasLoader(fastify)
    await noteSchemasLoader(fastify)
    loadUserSchemas(fastify)
  },
  { name: 'application-schemas' },
)
