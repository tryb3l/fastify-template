'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const diagnosticsChannel = require('node:diagnostics_channel')

const { createBoundedLruCache } = require('../../utils/lru-cache')

function createManualClock(initialMs = 1_000_000) {
  let currentMs = initialMs
  return {
    now() {
      return currentMs
    },
    advance(deltaMs) {
      currentMs += deltaMs
    },
  }
}

describe('createBoundedLruCache', () => {
  test('stores, retrieves raw values without wrapper envelopes, and deletes entries', () => {
    // Arrange
    const clock = createManualClock()
    const cache = createBoundedLruCache({
      maxEntries: 3,
      perf: clock,
      ttlResolution: 0,
    })

    // Act
    cache.set('k1', { ok: true }, 5_000)
    clock.advance(1_200)
    const hit = cache.get('k1')
    const miss = cache.get('missing')
    cache.delete('k1')
    const afterDelete = cache.get('k1')

    // Assert
    assert.deepEqual(hit, { ok: true })
    assert.equal(miss, null)
    assert.equal(afterDelete, null)
  })

  test('expires entries lazily on monotonic clock progression', () => {
    // Arrange
    const clock = createManualClock()
    const cache = createBoundedLruCache({
      maxEntries: 2,
      perf: clock,
      ttlResolution: 0,
    })
    cache.set('short', 'val', 100)

    // Act
    clock.advance(99)
    const beforeExpiry = cache.get('short')
    clock.advance(2)
    const afterExpiry = cache.get('short')

    // Assert
    assert.equal(beforeExpiry, 'val')
    assert.equal(afterExpiry, null)
  })

  test('ignores or deletes entries when TTL is non-positive/non-finite or value is nullish', () => {
    // Arrange
    const cache = createBoundedLruCache({ maxEntries: 3 })
    cache.set('k1', 'v1', 1_000)
    cache.set('kNull', 'initial', 1_000)

    // Act
    cache.set('k1', 'v2', 0)
    cache.set('k2', 'v2', -5)
    cache.set('k3', 'v3', Number.NaN)
    cache.set('kNull', null, 1_000)
    cache.set('kUndefined', undefined, 1_000)

    // Assert
    assert.equal(cache.get('k1'), null)
    assert.equal(cache.get('k2'), null)
    assert.equal(cache.get('k3'), null)
    assert.equal(cache.get('kNull'), null)
    assert.equal(cache.get('kUndefined'), null)
  })

  test('evicts least-recently-used entry and refreshes recency on get and overwrite', () => {
    // Arrange
    const cache = createBoundedLruCache({ maxEntries: 2 })
    cache.set('a', 1, 10_000)
    cache.set('b', 2, 10_000)

    // Act: touch 'a' so 'b' becomes LRU, then insert 'c'
    assert.equal(cache.get('a'), 1)
    cache.set('c', 3, 10_000)

    // Assert: 'b' evicted, 'a' and 'c' kept
    assert.equal(cache.get('b'), null)
    assert.equal(cache.get('a'), 1)
    assert.equal(cache.get('c'), 3)

    // Act: overwrite 'a' so 'a' moves to MRU, then insert 'd'
    cache.set('a', 10, 10_000)
    cache.set('d', 4, 10_000)

    // Assert: 'c' was LRU and evicted; 'a' and 'd' remain
    assert.equal(cache.get('c'), null)
    assert.equal(cache.get('a'), 10)
    assert.equal(cache.get('d'), 4)
  })

  test('coalesces concurrent cold fetches, skips caching null misses, and prevents stale writes after mid-flight delete', async () => {
    // Arrange
    const cache = createBoundedLruCache({ maxEntries: 4 })
    let userQueries = 0
    let releaseQuery
    const queryGate = new Promise((resolve) => {
      releaseQuery = resolve
    })

    // Act: parallel cold fetches for the same user session key
    const p1 = cache.fetch(
      'user:u1',
      async () => {
        userQueries += 1
        await queryGate
        return { id: 'u1', credentialsVersion: 1 }
      },
      60_000,
    )
    const p2 = cache.fetch(
      'user:u1',
      async () => {
        userQueries += 1
        return { id: 'u1', credentialsVersion: 99 }
      },
      60_000,
    )
    releaseQuery()
    const [r1, r2] = await Promise.all([p1, p2])
    const warmHit = await cache.fetch(
      'user:u1',
      async () => {
        throw new Error('warm hit must not invoke loader')
      },
      60_000,
    )

    // Assert: coalesced into 1 query and cached for warm fast-path
    assert.equal(userQueries, 1)
    assert.deepEqual(r1, { id: 'u1', credentialsVersion: 1 })
    assert.deepEqual(r2, { id: 'u1', credentialsVersion: 1 })
    assert.deepEqual(warmHit, { id: 'u1', credentialsVersion: 1 })

    // Act: null miss for unknown user is not cached
    let missingCalls = 0
    const miss1 = await cache.fetch(
      'user:missing',
      async () => {
        missingCalls += 1
        return null
      },
      60_000,
    )
    const miss2 = await cache.fetch(
      'user:missing',
      async () => {
        missingCalls += 1
        return { id: 'created-later' }
      },
      60_000,
    )

    // Assert
    assert.equal(miss1, null)
    assert.deepEqual(miss2, { id: 'created-later' })
    assert.equal(missingCalls, 2)

    // Act: mid-flight delete suppresses stale cache write without rejecting caller
    let releaseStale
    const staleGate = new Promise((resolve) => {
      releaseStale = resolve
    })
    const staleRead = cache.fetch(
      'user:race',
      async () => {
        await staleGate
        return { id: 'race', credentialsVersion: 1 }
      },
      60_000,
    )
    cache.delete('user:race')
    releaseStale()
    const resolvedToCaller = await staleRead

    // Assert
    assert.deepEqual(resolvedToCaller, { id: 'race', credentialsVersion: 1 })
    assert.equal(cache.get('user:race'), null)
  })

  test('publishes cache metrics over node:diagnostics_channel when subscribed', (t) => {
    // Arrange
    const events = []
    const channel = diagnosticsChannel.channel('lru-cache:metrics')
    const onMetric = (message) => {
      events.push(message)
    }
    channel.subscribe(onMetric)
    t.after(() => {
      channel.unsubscribe(onMetric)
    })
    const cache = createBoundedLruCache({ maxEntries: 4 })

    // Act
    cache.set('user:dc', { id: 'dc' }, 60_000)
    const hit = cache.get('user:dc')
    const miss = cache.get('user:absent')

    // Assert
    assert.deepEqual(hit, { id: 'dc' })
    assert.equal(miss, null)
    assert.ok(events.length >= 3)
  })
})
