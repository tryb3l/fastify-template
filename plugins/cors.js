'use strict'
/**
 * Fastify plugin for enabling Cross-Origin Resource Sharing (CORS).
 *
 * @module corsPlugin
 * @param {Object} fastify - The Fastify instance.
 * @param {Object} opts - The options object.
 * @returns {Promise<void>} - A promise that resolves when the plugin is registered.
 */

const fp = require('fastify-plugin')
const fastifyCors = require('@fastify/cors')

module.exports = fp(async function corsPlugin(fastify) {
  fastify.register(fastifyCors, {
    origin: false,
  })
})
