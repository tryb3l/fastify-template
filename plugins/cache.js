'use strict'

const fp = require('fastify-plugin')
const fastifyCaching = require('@fastify/caching')
const { promisify } = require('node:util')

module.exports = fp(async function cachePlugin(fastify, opts) {
    fastify.log.info('Starting registration of cache plugin')

    await fastify.register(fastifyCaching)

    fastify.decorate('cacheGet', promisify(fastify.cache.get.bind(fastify.cache)))
    fastify.decorate('cacheSet', promisify(fastify.cache.set.bind(fastify.cache)))
    fastify.decorate('cacheDelete', promisify(fastify.cache.delete.bind(fastify.cache)))

    fastify.log.info('Successfully registered cache plugin')
}, { name: 'app-cache' })