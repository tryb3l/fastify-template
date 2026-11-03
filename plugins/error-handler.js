'use strict'

const fp = require('fastify-plugin')
const { instantFromDate, instantToIsoString } = require('../utils/time')

module.exports = fp(
  async function errorHandlerPlugin(fastify) {
    fastify.addHook('onRequest', (req, reply, done) => {
      reply.header('x-request-id', req.id)
      req.log.info({ req }, 'incoming request')
      done()
    })

    fastify.addHook('onResponse', (req, reply, done) => {
      req.log.info({ req, res: reply }, 'request completed')
      done()
    })

    fastify.setErrorHandler((err, req, reply) => {
      const statusCode = err.statusCode || (reply.statusCode >= 400 ? reply.statusCode : 500)
      const logLevel = statusCode >= 500 ? 'error' : 'warn'

      if (reply.sent || reply.raw?.headersSent) {
        req.log[logLevel]({ req, res: reply, err }, err.message)
        return
      }

      reply.code(statusCode)
      req.log[logLevel]({ req, res: reply, err }, err.message)

      if (statusCode === 410 && err.syncCode) {
        return reply.send({
          message: err.message,
          code: err.syncCode,
        })
      }

      if (statusCode === 409 && err.conflictCode) {
        if (err.currentRevision !== undefined && err.currentModifiedAt !== undefined) {
          return reply.send({
            message: err.message,
            code: err.conflictCode,
            currentRevision: err.currentRevision,
            currentModifiedAt:
              err.currentModifiedAt instanceof Date
                ? instantToIsoString(instantFromDate(err.currentModifiedAt))
                : err.currentModifiedAt,
          })
        }
        return reply.send({
          message: err.message,
          code: err.conflictCode,
        })
      }

      if (err.validation) {
        return reply.send({
          statusCode,
          error: err.error || err.name || 'Error',
          message: 'Validation failed',
          requestId: req.id,
          details: err.validation,
        })
      }

      let message = err.message
      if (statusCode >= 500) {
        message = 'Fatal error. Contact the support team.'
      } else if (statusCode === 429) {
        message = 'You hit the rate limit! Slow down please!'
      }

      reply.send({
        statusCode,
        error: err.error || err.name || 'Error',
        message,
        requestId: req.id,
      })
    })

    fastify.setNotFoundHandler((req, reply) => {
      req.log.info({ req, res: reply }, 'Route not found')
      reply.code(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'The requested resource could not be found',
        requestId: req.id,
      })
    })
  },
  { name: 'error-handler' },
)
