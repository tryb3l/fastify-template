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

function resolveHttpsOptions(env = process.env) {
  if (env.HTTPS_ENABLED === 'false') {
    return null
  }

  const hasExplicitCertPaths = Boolean(env.HTTPS_KEY_PATH && env.HTTPS_CERT_PATH)
  if (env.NODE_ENV === 'production' && env.HTTPS_ENABLED !== 'true' && !hasExplicitCertPaths) {
    return null
  }

  const defaultCertsDir = path.join(__dirname, '..', '.certs')
  const keyPath = env.HTTPS_KEY_PATH || path.join(defaultCertsDir, 'localhost-key.pem')
  const certPath = env.HTTPS_CERT_PATH || path.join(defaultCertsDir, 'localhost.pem')

  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    return null
  }

  return {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  }
}

function resolveTrustProxy(raw = process.env.TRUST_PROXY) {
  if (raw === undefined || raw === null) {
    return false
  }
  if (typeof raw === 'boolean') {
    return raw
  }
  if (typeof raw === 'number') {
    return Number.isInteger(raw) && raw > 0 ? raw : false
  }

  const trimmed = String(raw).trim()
  if (trimmed === '' || trimmed.toLowerCase() === 'false' || trimmed === '0') {
    return false
  }
  if (trimmed.toLowerCase() === 'true') {
    return true
  }
  if (/^\d+$/.test(trimmed)) {
    const hops = Number(trimmed)
    return hops > 0 ? hops : false
  }
  if (trimmed.includes(',')) {
    return trimmed
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
  }

  return trimmed
}

const httpsOptions = resolveHttpsOptions()

const serverOptions = {
  ...(httpsOptions ? { https: httpsOptions } : {}),
  trustProxy: resolveTrustProxy(),
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

Object.defineProperties(serverOptions, {
  resolveHttpsOptions: {
    value: resolveHttpsOptions,
    enumerable: false,
  },
  resolveTrustProxy: {
    value: resolveTrustProxy,
    enumerable: false,
  },
})

module.exports = serverOptions
