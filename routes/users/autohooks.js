'use strict'

module.exports = async function (fastify, opts) {
    fastify.addHook('onRequest', fastify.authenticate)
}
