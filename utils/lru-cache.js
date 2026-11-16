'use strict'

const { LRUCache } = require('lru-cache')

const DEFAULT_CACHE_MAX_ENTRIES = 2_000
const DEFAULT_CACHE_MAX_BYTES = 32_000_000
const DEFAULT_CACHE_MAX_ENTRY_BYTES = 256_000
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000

const NOTE_BASE_BYTES = 512
const NOTE_TAG_BYTES = 64
const NOTE_ATTACHMENT_BYTES = 256
const NOTE_LINK_BYTES = 128
const GENERIC_OBJECT_BASE_BYTES = 256
const MAX_SHALLOW_PROP_SAMPLE = 16
const MAX_SMI_BOUND = 0x3fffffff

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

function clampPositiveBytes(total) {
  if (!Number.isFinite(total) || total <= 1) {
    return 1
  }
  return total <= MAX_SMI_BOUND ? total | 0 : Math.trunc(total)
}

// Constant-time V8 heap footprint approximation using UTF-16 string length headers
// and array lengths; avoids O(N) Buffer.byteLength scans on 50KB Markdown bodies.
function estimateEntryBytes(value) {
  if (typeof value === 'string') {
    return clampPositiveBytes(value.length * 2)
  }

  if (value === null || typeof value !== 'object') {
    return 16
  }

  if (typeof value.body === 'string' && typeof value.title === 'string') {
    const tagsBytes = Array.isArray(value.tags) ? value.tags.length * NOTE_TAG_BYTES : 0
    const attachmentsBytes = Array.isArray(value.attachments)
      ? value.attachments.length * NOTE_ATTACHMENT_BYTES
      : 0
    const linksBytes = Array.isArray(value.links) ? value.links.length * NOTE_LINK_BYTES : 0

    return clampPositiveBytes(
      NOTE_BASE_BYTES +
        value.title.length * 2 +
        value.body.length * 2 +
        tagsBytes +
        attachmentsBytes +
        linksBytes,
    )
  }

  if (Array.isArray(value)) {
    return clampPositiveBytes(GENERIC_OBJECT_BASE_BYTES + value.length * 64)
  }

  let bytes = GENERIC_OBJECT_BASE_BYTES
  let sampledProps = 0
  for (const key in value) {
    if (!Object.hasOwn(value, key)) {
      continue
    }
    const propVal = value[key]
    bytes += key.length * 2 + (typeof propVal === 'string' ? propVal.length * 2 : 16)
    sampledProps += 1
    if (sampledProps >= MAX_SHALLOW_PROP_SAMPLE) {
      break
    }
  }

  return clampPositiveBytes(bytes)
}

async function executeLoader(_key, _staleValue, options) {
  const loaded = await options.context()
  return loaded === null ? undefined : loaded
}

function createBoundedLruCache(options = {}) {
  const { maxEntries, maxBytes, maxEntryBytes, defaultTtlMs, perf, ttlResolution } = options
  const max = Math.max(1, Number(maxEntries) || DEFAULT_CACHE_MAX_ENTRIES)
  const ttl = Math.max(1, Number(defaultTtlMs) || DEFAULT_CACHE_TTL_MS)

  const lruOptions = {
    max,
    ttl,
    ignoreFetchAbort: true,
    fetchMethod: executeLoader,
  }

  if (maxBytes !== undefined) {
    const resolvedMaxBytes = Math.max(1, Number(maxBytes) || DEFAULT_CACHE_MAX_BYTES)
    const requestedEntryCeiling =
      maxEntryBytes !== undefined
        ? Math.max(1, Number(maxEntryBytes) || DEFAULT_CACHE_MAX_ENTRY_BYTES)
        : DEFAULT_CACHE_MAX_ENTRY_BYTES
    lruOptions.maxSize = resolvedMaxBytes
    lruOptions.maxEntrySize = Math.min(resolvedMaxBytes, requestedEntryCeiling)
    lruOptions.sizeCalculation = estimateEntryBytes
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
  DEFAULT_CACHE_MAX_BYTES,
  DEFAULT_CACHE_MAX_ENTRY_BYTES,
  DEFAULT_CACHE_TTL_MS,
  estimateEntryBytes,
  createBoundedLruCache,
}
