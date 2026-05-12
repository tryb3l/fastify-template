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

module.exports = {
  disableRequestLogging: true,
  logger: loggerOptions,
  childLoggerFactory(logger, bindings, opts, rawReq) {
    const traceId = extractTraceId(rawReq.headers?.traceparent)

    return logger.child(traceId ? { ...bindings, traceId } : bindings, opts)
  },
  requestIdLogLabel: 'requestId',
  requestIdHeader: false,
  pluginTimeout: 20000,
  genReqId() {
    return crypto.randomUUID()
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
