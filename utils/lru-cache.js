'use strict'

const { LRUCache } = require('lru-cache')

const DEFAULT_CACHE_MAX_ENTRIES = 2_000
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000

class SetCallOptions {
  constructor(ttl) {
    this.ttl = ttl
  }
}

class FetchCallOptions {
  constructor(ttl, context) {
    this.ttl = ttl
    this.context = context
  }
}

async function executeLoader(_key, _staleValue, options) {
  const loaded = await options.context()
  return loaded === null ? undefined : loaded
}

function createBoundedLruCache(options = {}) {
  const { maxEntries, defaultTtlMs, perf, ttlResolution } = options
  const max = Math.max(1, Number(maxEntries) || DEFAULT_CACHE_MAX_ENTRIES)
  const ttl = Math.max(1, Number(defaultTtlMs) || DEFAULT_CACHE_TTL_MS)

  const lruOptions = {
    max,
    ttl,
    ignoreFetchAbort: true,
    fetchMethod: executeLoader,
  }
  if (perf !== undefined) {
    lruOptions.perf = perf
  }
  if (ttlResolution !== undefined) {
    lruOptions.ttlResolution = ttlResolution
  }

  const lru = new LRUCache(lruOptions)

  function get(key) {
    const value = lru.get(key)
    return value === undefined ? null : value
  }

  function set(key, value, ttlMs) {
    if (value === null || value === undefined) {
      lru.delete(key)
      return
    }

    if (ttlMs !== undefined) {
      const numericTtl = Number(ttlMs)
      if (!Number.isFinite(numericTtl) || numericTtl <= 0) {
        lru.delete(key)
        return
      }
      lru.set(key, value, new SetCallOptions(numericTtl))
      return
    }

    lru.set(key, value)
  }

  function del(key) {
    lru.delete(key)
  }

  async function fetch(key, loader, ttlMs) {
    const hit = lru.get(key)
    if (hit !== undefined) {
      return hit
    }

    let effectiveTtl = ttl
    if (ttlMs !== undefined) {
      const numericTtl = Number(ttlMs)
      if (!Number.isFinite(numericTtl) || numericTtl <= 0) {
        lru.delete(key)
        const uncached = await loader()
        return uncached ?? null
      }
      effectiveTtl = numericTtl
    }

    const fetched = await lru.fetch(key, new FetchCallOptions(effectiveTtl, loader))
    return fetched === undefined ? null : fetched
  }

  return {
    get,
    set,
    delete: del,
    fetch,
  }
}

module.exports = {
  DEFAULT_CACHE_MAX_ENTRIES,
  DEFAULT_CACHE_TTL_MS,
  createBoundedLruCache,
}
