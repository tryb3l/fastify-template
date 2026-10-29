'use strict'

module.exports = async function (fastify) {
  fastify.addHook('onRequest', fastify.authenticate)
  fastify.addHook('onRequest', fastify.bindScopedDataSources)
}
