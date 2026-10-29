'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { LogController } = require('fastify')
const loggerOptions = require('./logger-options')

// W3C Trace Context: version(2)-trace_id(32)-parent_id(16)-flags(2)
const TRACEPARENT_RE = /^[\da-f]{2}-([\da-f]{32})-[\da-f]{16}-[\da-f]{2}$/

function extractTraceId(raw) {
  if (!raw || typeof raw !== 'string') return null
  const match = TRACEPARENT_RE.exec(raw)
  return match ? match[1] : null
}

function resolveHttpsOptions() {
  if (process.env.HTTPS_ENABLED === 'false') {
    return null
  }

  const defaultCertsDir = path.join(__dirname, '..', '.certs')
  const keyPath = process.env.HTTPS_KEY_PATH || path.join(defaultCertsDir, 'localhost-key.pem')
  const certPath = process.env.HTTPS_CERT_PATH || path.join(defaultCertsDir, 'localhost.pem')

  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    return null
  }

  return {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  }
}

const httpsOptions = resolveHttpsOptions()

module.exports = {
  ...(httpsOptions ? { https: httpsOptions } : {}),
  logger: loggerOptions,
  childLoggerFactory(logger, bindings, opts, rawReq) {
    const traceId = extractTraceId(rawReq.headers?.traceparent)

    return logger.child(traceId ? { ...bindings, traceId } : bindings, opts)
  },
  logController: new LogController({
    disableRequestLogging: true,
    requestIdLogLabel: 'requestId',
  }),
  requestIdHeader: false,
  pluginTimeout: 20000,
  genReqId() {
    return crypto.randomUUIDv7()
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
