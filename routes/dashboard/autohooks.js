'use strict'

module.exports = async function (fastify) {
  fastify.addHook('onRequest', fastify.authenticate)
}
