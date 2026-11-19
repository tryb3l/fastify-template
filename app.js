'use strict'

const path = require('node:path')
const AutoLoad = require('@fastify/autoload')

module.exports = async function (fastify, opts) {
  try {
    // Load Schemas
    await fastify.register(require('./schemas/loader'))

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
  } catch (err) {
    fastify.log.error(err)
    throw err
  }
}

module.exports.options = require('./configs/server-options')
