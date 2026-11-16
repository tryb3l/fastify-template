'use strict'

const fp = require('fastify-plugin')
const {
  DEFAULT_CACHE_MAX_ENTRIES,
  DEFAULT_CACHE_MAX_BYTES,
  DEFAULT_CACHE_MAX_ENTRY_BYTES,
  isUserCacheKey,
  createBoundedLruCache,
} = require('../utils/lru-cache')

module.exports = fp(
  async function cachePlugin(fastify, opts = {}) {
    fastify.log.info('Starting registration of cache plugin')

    const maxEntries = fastify.config.CACHE_MAX_ENTRIES ?? DEFAULT_CACHE_MAX_ENTRIES
    const maxBytes = fastify.config.CACHE_MAX_BYTES ?? DEFAULT_CACHE_MAX_BYTES
    const sharedClockOptions = {
      perf: opts.perf,
      ttlResolution: opts.ttlResolution,
    }

    const userPartition = createBoundedLruCache({
      maxEntries,
      ...sharedClockOptions,
    })
    const entityPartition = createBoundedLruCache({
      maxEntries,
      maxBytes,
      maxEntryBytes: DEFAULT_CACHE_MAX_ENTRY_BYTES,
      ...sharedClockOptions,
    })

    function selectPartition(key) {
      return isUserCacheKey(key) ? userPartition : entityPartition
    }

    fastify.decorate('cacheGet', function cacheGet(key) {
      return selectPartition(key).get(key)
    })
    fastify.decorate('cacheSet', function cacheSet(key, value, ttl) {
      selectPartition(key).set(key, value, ttl)
    })
    fastify.decorate('cacheDelete', function cacheDelete(key) {
      selectPartition(key).delete(key)
    })
    fastify.decorate('cacheFetch', function cacheFetch(key, loader, ttl) {
      return selectPartition(key).fetch(key, loader, ttl)
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
