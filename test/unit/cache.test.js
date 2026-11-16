'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')

const { createBoundedLruCache } = require('../../plugins/cache')

describe('createBoundedLruCache', () => {
  test('stores, retrieves, and deletes entries with remaining TTL metadata', (t) => {
    // Arrange
    t.mock.timers.enable({ apis: ['Date'] })
    t.mock.timers.setTime(1_000_000)
    const cache = createBoundedLruCache(3)

    // Act
    cache.set('k1', { ok: true }, 5_000)
    t.mock.timers.tick(1_200)
    const hit = cache.get('k1')
    const miss = cache.get('missing')
    cache.delete('k1')
    const afterDelete = cache.get('k1')

    // Assert
    assert.deepEqual(hit, {
      item: { ok: true },
      stored: 1_000_000,
      ttl: 3_800,
    })
    assert.equal(miss, null)
    assert.equal(afterDelete, null)
  })

  test('expires entries lazily when TTL elapses', (t) => {
    // Arrange
    t.mock.timers.enable({ apis: ['Date'] })
    t.mock.timers.setTime(1_000_000)
    const cache = createBoundedLruCache(2)
    cache.set('short', 'val', 100)

    // Act
    t.mock.timers.tick(100)
    const expired = cache.get('short')

    // Assert
    assert.equal(expired, null)
  })

  test('ignores or deletes entries when TTL is zero, negative, or non-finite', () => {
    // Arrange
    const cache = createBoundedLruCache(2)
    cache.set('k1', 'v1', 1_000)

    // Act
    cache.set('k1', 'v2', 0)
    cache.set('k2', 'v2', -5)
    cache.set('k3', 'v3', Number.NaN)

    // Assert
    assert.equal(cache.get('k1'), null)
    assert.equal(cache.get('k2'), null)
    assert.equal(cache.get('k3'), null)
  })

  test('evicts least-recently-used entry and refreshes recency on get and overwrite', () => {
    // Arrange
    const cache = createBoundedLruCache(2)
    cache.set('a', 1, 10_000)
    cache.set('b', 2, 10_000)

    // Act: touch 'a' so 'b' becomes LRU, then insert 'c'
    assert.equal(cache.get('a').item, 1)
    cache.set('c', 3, 10_000)

    // Assert: 'b' evicted, 'a' and 'c' kept
    assert.equal(cache.get('b'), null)
    assert.equal(cache.get('a').item, 1)
    assert.equal(cache.get('c').item, 3)

    // Act: overwrite 'a' (now 'c' was touched most recently before overwrite, so 'a' moves to MRU)
    cache.set('a', 10, 10_000)
    cache.set('d', 4, 10_000)

    // Assert: 'c' was LRU and evicted; 'a' and 'd' remain
    assert.equal(cache.get('c'), null)
    assert.equal(cache.get('a').item, 10)
    assert.equal(cache.get('d').item, 4)
  })
})
