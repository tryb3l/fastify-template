'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { performance } = require('node:perf_hooks')
const { trimTrailingSlashes, resolvePrimaryFrontendUrl } = require('../../utils/url')
const { extractMarkdownLinks } = require('../../plugins/notes-store')

test('trimTrailingSlashes strips trailing slashes in linear time without polynomial backtracking', () => {
  assert.strictEqual(trimTrailingSlashes('https://example.com///'), 'https://example.com')
  assert.strictEqual(trimTrailingSlashes('https://example.com'), 'https://example.com')
  assert.strictEqual(trimTrailingSlashes('///'), '')
  assert.strictEqual(trimTrailingSlashes(''), '')

  const adversarial = `https://example.com${'/'.repeat(50_000)}x`
  const start = performance.now()
  const result = trimTrailingSlashes(adversarial)
  const elapsedMs = performance.now() - start

  assert.strictEqual(result, adversarial)
  assert.ok(
    elapsedMs < 20,
    `Expected linear-time execution (<20ms), took ${elapsedMs.toFixed(2)}ms`,
  )
})

test('resolvePrimaryFrontendUrl picks the first comma-delimited origin and strips trailing slashes', () => {
  assert.strictEqual(
    resolvePrimaryFrontendUrl('  https://app.example.com/// , https://admin.example.com/ '),
    'https://app.example.com',
  )
  assert.strictEqual(resolvePrimaryFrontendUrl('http://localhost:5173/'), 'http://localhost:5173')
  assert.strictEqual(resolvePrimaryFrontendUrl(undefined), '')
})

test('extractMarkdownLinks executes in linear time on adversarial 50KB repeated bracket payloads', () => {
  const targetId = '01950000-0000-7000-8000-000000000001'
  const adversarialBody = `${'['.repeat(49_900)}[Safe Label](note://${targetId})`

  const start = performance.now()
  const links = extractMarkdownLinks(adversarialBody)
  const elapsedMs = performance.now() - start

  assert.strictEqual(links.size, 1)
  assert.deepStrictEqual(links.get(targetId), {
    targetId,
    relation: 'related',
    label: 'Safe Label',
  })
  assert.ok(
    elapsedMs < 25,
    `Expected linear-time link scan (<25ms), took ${elapsedMs.toFixed(2)}ms`,
  )
})
