'use strict'

const path = require('node:path')
const AutoLoad = require('@fastify/autoload')
const closeWithGrace = require('close-with-grace')

// Pass --options via CLI arguments in command to enable these options.
const options = require('./configs/server-options.js')

module.exports = async function (fastify, opts) {
  // Place here your custom code!
  fastify.log.info('The .env file has been read %s', process.env.MONGO_URL)

  fastify.register(AutoLoad, {
    dir: path.join(__dirname, 'schemas'),
    indexPattern: /^loader.js$/i,
  })

  await fastify.register(require('./plugins/config'))
  fastify.log.info('Config loaded %o', fastify.config)

  // Do not touch the following lines

  // This loads all plugins defined in plugins
  // those should be support plugins that are reused
  // through your application
  fastify.register(AutoLoad, {
    dir: path.join(__dirname, 'plugins'),
    ignorePattern: /.*.no-load\.js/,
    indexPattern: /^no$/i,
    options: fastify.config,
  })

  // This loads all plugins defined in routes
  // define your routes in one of these
  fastify.register(AutoLoad, {
    dir: path.join(__dirname, 'routes'),
    indexPattern: /.*routes(\.js|\.cjs)$/i,
    ignorePattern: /.*\.js/,
    autoHooksPattern: /.*hooks(\.js|\.cjs)$/i,
    autoHooks: true,
    cascadeHooks: true,
    options: Object.assign({}, opts),
  })

  // Graceful shutdown handler
  // eslint-disable-next-line no-unused-vars
  closeWithGrace(async function ({ signal, err, manual }) {
    if (err) {
      fastify.log.error({ err }, 'server closing with error')
    } else {
      fastify.log.info(`${signal} received, server closing`)
    }
    await fastify.close()
  })
}

module.exports.options = options
