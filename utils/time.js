'use strict'

const ISO_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/

function getTemporalApi() {
  if (!globalThis.Temporal) {
    throw new Error('Temporal API is unavailable in this Node.js runtime')
  }

  return globalThis.Temporal
}

function padNumber(value, length = 2) {
  return String(value).padStart(length, '0')
}

function instantToTemporalInstant(value) {
  if (!value || !Number.isFinite(value.epochMilliseconds)) {
    throw new TypeError('Expected an instant-like value')
  }

  return getTemporalApi().Instant.fromEpochMilliseconds(Math.trunc(value.epochMilliseconds))
}

function createInstant(epochMilliseconds) {
  if (!Number.isFinite(epochMilliseconds)) {
    throw new TypeError('Expected a finite epoch millisecond value')
  }

  return { epochMilliseconds }
}

function nowInstant() {
  return createInstant(Number(getTemporalApi().Now.instant().epochMilliseconds))
}

function parseIsoInstant(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError('Expected a non-empty ISO 8601 date-time string')
  }

  if (!ISO_INSTANT_PATTERN.test(value)) {
    throw new RangeError('Expected a valid ISO 8601 date-time string with an explicit offset')
  }

  const epochMilliseconds = Date.parse(value)

  if (Number.isNaN(epochMilliseconds)) {
    throw new RangeError('Expected a valid ISO 8601 date-time string with an explicit offset')
  }

  return createInstant(epochMilliseconds)
}

function instantFromDate(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError('Expected a valid Date instance')
  }

  return createInstant(value.getTime())
}

function instantToDate(value) {
  if (!value || !Number.isFinite(value.epochMilliseconds)) {
    throw new TypeError('Expected an instant-like value')
  }

  return new Date(value.epochMilliseconds)
}

function instantToIsoString(value) {
  return instantToTemporalInstant(value).toString({ smallestUnit: 'millisecond' })
}

function instantToFileStamp(value) {
  const utcDateTime = instantToTemporalInstant(value).toZonedDateTimeISO('UTC')

  return [
    padNumber(utcDateTime.year, 4),
    '-',
    padNumber(utcDateTime.month),
    '-',
    padNumber(utcDateTime.day),
    'T',
    padNumber(utcDateTime.hour),
    '-',
    padNumber(utcDateTime.minute),
    '-',
    padNumber(utcDateTime.second),
    '-',
    padNumber(utcDateTime.millisecond, 3),
    'Z',
  ].join('')
}

function nowIsoInstantString() {
  return instantToIsoString(nowInstant())
}

function nowFileStamp() {
  return instantToFileStamp(nowInstant())
}

function addInstantDuration(value, duration) {
  if (!duration || typeof duration !== 'object') {
    throw new TypeError('Expected a duration object')
  }

  const milliseconds =
    (duration.days ?? 0) * 24 * 60 * 60 * 1000 +
    (duration.hours ?? 0) * 60 * 60 * 1000 +
    (duration.minutes ?? 0) * 60 * 1000 +
    (duration.seconds ?? 0) * 1000 +
    (duration.milliseconds ?? 0)

  return createInstant(instantToDate(value).getTime() + milliseconds)
}

function compareInstants(left, right) {
  const delta = instantToDate(left).getTime() - instantToDate(right).getTime()

  return delta === 0 ? 0 : delta > 0 ? 1 : -1
}

module.exports = {
  addInstantDuration,
  compareInstants,
  instantFromDate,
  instantToFileStamp,
  instantToDate,
  instantToIsoString,
  nowFileStamp,
  nowInstant,
  nowIsoInstantString,
  parseIsoInstant,
}
