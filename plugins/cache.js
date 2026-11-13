'use strict'

const fp = require('fastify-plugin')

const DEFAULT_CACHE_MAX_ENTRIES = 2_000

function createBoundedLruCache(maxEntries = DEFAULT_CACHE_MAX_ENTRIES) {
  const limit = Math.max(1, Number(maxEntries) || DEFAULT_CACHE_MAX_ENTRIES)
  const store = new Map()

  function get(key) {
    const entry = store.get(key)
    if (!entry) {
      return null
    }

    const now = Date.now()
    const remainingTtl = entry.expiresAt - now
    if (remainingTtl <= 0) {
      store.delete(key)
      return null
    }

    // Refresh LRU order in O(1)
    store.delete(key)
    store.set(key, entry)

    return {
      item: entry.item,
      stored: entry.stored,
      ttl: remainingTtl,
    }
  }

  function set(key, value, ttlMs) {
    const numericTtl = Number(ttlMs)
    if (!Number.isFinite(numericTtl) || numericTtl <= 0) {
      store.delete(key)
      return
    }

    const now = Date.now()
    if (store.has(key)) {
      store.delete(key)
    } else if (store.size >= limit) {
      const oldestKey = store.keys().next().value
      if (oldestKey !== undefined) {
        store.delete(oldestKey)
      }
    }

    store.set(key, {
      item: value,
      stored: now,
      expiresAt: now + numericTtl,
    })
  }

  function del(key) {
    store.delete(key)
  }

  return {
    get,
    set,
    delete: del,
  }
}

module.exports = fp(
  async function cachePlugin(fastify) {
    fastify.log.info('Starting registration of cache plugin')

    const maxEntries =
      fastify.config?.CACHE_MAX_ENTRIES ??
      process.env.CACHE_MAX_ENTRIES ??
      DEFAULT_CACHE_MAX_ENTRIES
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
  },
)
