'use strict'
const crypto = require('node:crypto')
const loggerOptions = require('./logger-options')

// W3C Trace Context: version(2)-trace_id(32)-parent_id(16)-flags(2)
const TRACEPARENT_RE = /^[\da-f]{2}-([\da-f]{32})-[\da-f]{16}-[\da-f]{2}$/

function extractTraceId(raw) {
  if (!raw || typeof raw !== 'string') return null
  const match = TRACEPARENT_RE.exec(raw)
  return match ? match[1] : null
}

function sanitizeRequestId(value) {
  if (!value || typeof value !== 'string') return null
  // Cap at 128 chars to prevent memory abuse from oversized headers
  if (value.length > 128) return null
  return value
}

module.exports = {
  disableRequestLogging: true,
  logger: {
    ...loggerOptions,
    formatters: {
      ...loggerOptions.formatters,
      log: (object) => {
        if (object.reqId && object.reqId.length === 32 && /^[\da-f]{32}$/.test(object.reqId)) {
          object.trace_id = object.reqId
        }
        return object
      },
    },
  },
  requestIdLogLabel: false,
  requestIdHeader: false,
  pluginTimeout: 20000,
  genReqId(req) {
    const traceId = extractTraceId(req.headers['traceparent'])
    if (traceId) return traceId

    return (
      sanitizeRequestId(req.headers['x-request-id']) ||
      sanitizeRequestId(req.headers['x-amz-request-id']) ||
      crypto.randomUUID()
    )
  },
  ajv: {
    customOptions: {
      removeAdditional: 'all',
      prettyPrint: true,
      coerceTypes: 'array',
      allErrors: true,
    },
  },
}
