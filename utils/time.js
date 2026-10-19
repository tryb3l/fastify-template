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
  const Temporal = getTemporalApi()
  if (value instanceof Temporal.Instant) {
    return value
  }
  if (!value || !Number.isFinite(value.epochMilliseconds)) {
    throw new TypeError('Expected an instant-like value')
  }

  return Temporal.Instant.fromEpochMilliseconds(Math.trunc(value.epochMilliseconds))
}

function nowInstant() {
  return getTemporalApi().Now.instant()
}

function parseIsoInstant(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError('Expected a non-empty ISO 8601 date-time string')
  }

  if (!ISO_INSTANT_PATTERN.test(value)) {
    throw new RangeError('Expected a valid ISO 8601 date-time string with an explicit offset')
  }

  try {
    return getTemporalApi().Instant.from(value)
  } catch {
    throw new RangeError('Expected a valid ISO 8601 date-time string with an explicit offset')
  }
}

function instantFromDate(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError('Expected a valid Date instance')
  }

  return getTemporalApi().Instant.fromEpochMilliseconds(value.getTime())
}

function instantToDate(value) {
  return new Date(instantToTemporalInstant(value).epochMilliseconds)
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

  return instantToTemporalInstant(value).add({
    hours: (duration.days ?? 0) * 24 + (duration.hours ?? 0),
    minutes: duration.minutes ?? 0,
    seconds: duration.seconds ?? 0,
    milliseconds: duration.milliseconds ?? 0,
  })
}

function compareInstants(left, right) {
  return getTemporalApi().Instant.compare(
    instantToTemporalInstant(left),
    instantToTemporalInstant(right),
  )
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
