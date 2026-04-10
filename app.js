'use strict'

const path = require('node:path')
const AutoLoad = require('@fastify/autoload')
const closeWithGrace = require('close-with-grace')

module.exports = async function (fastify, opts) {
  try {
    // Register base schema
    await require('./routes/auth/schemas/loader').authSchemasLoader(fastify)
    await require('./routes/notes/schemas/loader').noteSchemasLoader(fastify)
    await require('./routes/users/schemas/loader').loadUserSchemas(fastify)

    // Load Config
    await fastify.register(require('./plugins/config'), opts)

    // Load Plugins
    await fastify.register(AutoLoad, {
      dir: path.join(__dirname, 'plugins'),
      ignorePattern: /.*.no-load\.js/,
      indexPattern: /^no$/i,
      options: Object.assign({}, opts),
    })

    // Load Routes
    await fastify.register(AutoLoad, {
      dir: path.join(__dirname, 'routes'),
      indexPattern: /.*routes(\.js|\.cjs)$/i,
      ignorePattern: /(?:^|\/)(?:schemas|utils)(?:\/|$).*\.js/,
      autoHooksPattern: /.*hooks(\.js|\.cjs)$/i,
      autoHooks: true,
      cascadeHooks: true,
      options: Object.assign({}, opts),
    })

    const closeListeners = closeWithGrace(
      { delay: process.env.FASTIFY_CLOSE_GRACE_DELAY || 500 },
      async function ({ signal, err, manual }) {
        if (err) {
          fastify.log.error({ err }, 'Server closing due to error')
        } else {
          fastify.log.info(`${signal} received, gracefully shutting down server...`)
        }

        await fastify.close()
      },
    )

    fastify.addHook('onClose', (instance, done) => {
      closeListeners.uninstall()
      done()
    })
  } catch (err) {
    fastify.log.error(err)
    throw err
  }
}
