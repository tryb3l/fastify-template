'use strict'

const test = require('node:test')
const assert = require('node:assert')

const {
  addInstantDuration,
  compareInstants,
  instantFromDate,
  instantToFileStamp,
  instantToDate,
  instantToIsoString,
  nowFileStamp,
  nowIsoInstantString,
  parseIsoInstant,
} = require('../../utils/time')

test('parseIsoInstant parses RFC 3339 timestamps into instants', () => {
  // Arrange
  const isoString = '2026-05-06T12:34:56.789Z'

  // Act
  const instant = parseIsoInstant(isoString)

  // Assert
  assert.strictEqual(instant.epochMilliseconds, Date.parse(isoString))
})

test('parseIsoInstant rejects invalid timestamps', () => {
  // Arrange
  const invalidIsoString = '2026-05-06 12:34:56'

  // Act / Assert
  assert.throws(
    () => parseIsoInstant(invalidIsoString),
    /valid ISO 8601 date-time string with an explicit offset/,
  )
})

test('instantFromDate and instantToDate round-trip millisecond precision', () => {
  // Arrange
  const originalDate = new Date('2026-05-06T12:34:56.789Z')

  // Act
  const instant = instantFromDate(originalDate)
  const roundTrippedDate = instantToDate(instant)

  // Assert
  assert.notStrictEqual(roundTrippedDate, originalDate)
  assert.strictEqual(roundTrippedDate.toISOString(), originalDate.toISOString())
})

test('addInstantDuration and compareInstants support expiry arithmetic', () => {
  // Arrange
  const issuedAt = parseIsoInstant('2026-05-06T12:00:00.000Z')

  // Act
  const expiresAt = addInstantDuration(issuedAt, { minutes: 15 })

  // Assert
  assert.strictEqual(compareInstants(expiresAt, issuedAt), 1)
  assert.strictEqual(instantToIsoString(expiresAt), '2026-05-06T12:15:00.000Z')
})

test('instantToIsoString normalizes sub-millisecond precision to Date-compatible ISO strings', () => {
  // Arrange
  const instant = parseIsoInstant('2026-05-06T12:34:56.789123456Z')

  // Act
  const isoString = instantToIsoString(instant)

  // Assert
  assert.strictEqual(isoString, '2026-05-06T12:34:56.789Z')
})

test('instantToFileStamp formats a UTC-safe file stamp', () => {
  // Arrange
  const instant = parseIsoInstant('2026-05-06T12:34:56.789123456Z')

  // Act
  const fileStamp = instantToFileStamp(instant)

  // Assert
  assert.strictEqual(fileStamp, '2026-05-06T12-34-56-789Z')
})

test('now helpers return Temporal-aligned ISO and file-safe timestamp shapes', () => {
  // Act
  const isoString = nowIsoInstantString()
  const fileStamp = nowFileStamp()

  // Assert
  assert.match(isoString, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  assert.match(fileStamp, /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/)
})
