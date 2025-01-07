'use strict'

const path = require('node:path')
const AutoLoad = require('@fastify/autoload')
const closeWithGrace = require('close-with-grace')

module.exports = async function (fastify, opts) {
  // Load schemas first
  try {
    // Register base schema
    await fastify.addSchema(require('./schemas/dotenv.json'))

    // Register all other schemas
    await fastify.register(async (instance) => {
      // Load auth schemas first since they're referenced by others
      await require('./routes/auth/schemas/loader').authSchemasLoader(instance)
      // Then load feature schemas
      await require('./routes/notes/schemas/loader').noteSchemasLoader(instance)
      await require('./routes/users/schemas/loader').loadUserSchemas(instance)
    })

    // Load plugins
    await fastify.register(require('./plugins/config'))

    // Load other plugins
    await fastify.register(AutoLoad, {
      dir: path.join(__dirname, 'plugins'),
      ignorePattern: /.*.no-load\.js/,
      indexPattern: /^no$/i,
      options: Object.assign({}, opts)
    })

    // Load routes last
    await fastify.register(AutoLoad, {
      dir: path.join(__dirname, 'routes'),
      indexPattern: /.*routes(\.js|\.cjs)$/i,
      ignorePattern: /(?:^|\/)(?:schemas|utils)(?:\/|$).*\.js/,
      autoHooksPattern: /.*hooks(\.js|\.cjs)$/i,
      autoHooks: true,
      cascadeHooks: true,
      options: Object.assign({}, opts)
    })

  } catch (err) {
    fastify.log.error(err)
    throw err
  }
}