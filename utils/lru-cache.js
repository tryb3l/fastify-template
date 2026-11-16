'use strict'

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

module.exports = {
  DEFAULT_CACHE_MAX_ENTRIES,
  createBoundedLruCache,
}
