'use strict'

const fp = require('fastify-plugin')
const { DEFAULT_CACHE_MAX_ENTRIES, createBoundedLruCache } = require('../utils/lru-cache')

module.exports = fp(
  async function cachePlugin(fastify) {
    fastify.log.info('Starting registration of cache plugin')

    const maxEntries = fastify.config.CACHE_MAX_ENTRIES ?? DEFAULT_CACHE_MAX_ENTRIES
    const lru = createBoundedLruCache(maxEntries)

    fastify.decorate('cacheGet', async function cacheGet(key) {
      return lru.get(key)
    })
    fastify.decorate('cacheSet', async function cacheSet(key, value, ttl) {
      lru.set(key, value, ttl)
    })
    fastify.decorate('cacheDelete', async function cacheDelete(key) {
      lru.delete(key)
    })

    fastify.log.info('Successfully registered cache plugin')
  },
  {
    name: 'app-cache',
    dependencies: ['application-config'],
    decorators: {
      fastify: ['config'],
    },
  },
)
