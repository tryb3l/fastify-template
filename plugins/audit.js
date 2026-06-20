'use strict'

const fp = require('fastify-plugin')
const { instantToDate, nowInstant } = require('../utils/time')

const pendingAuditWrites = new Set()

async function flushAuditLogs() {
  while (pendingAuditWrites.size > 0) {
    await Promise.allSettled(Array.from(pendingAuditWrites))
  }
}

function trackAuditWrite(auditWrite) {
  pendingAuditWrites.add(auditWrite)
  auditWrite.finally(() => pendingAuditWrites.delete(auditWrite))
}

const auditPlugin = fp(
  async function auditPlugin(fastify) {
    fastify.log.info('Starting registration of audit plugin')

    const auditLogs = fastify.mongo.db.collection('auditLogs')

    fastify.decorate('flushAuditLogs', flushAuditLogs)

    fastify.addHook('onClose', async function closeAuditPlugin() {
      await flushAuditLogs()
    })

    fastify.decorate(
      'auditLog',
      function auditLog({ request, action, userId, resourceType, resourceId, details }) {
        let boundedDetails
        if (details !== undefined) {
          try {
            const serialized = JSON.stringify(details)
            if (serialized.length <= 2048) {
              boundedDetails = details
            } else {
              boundedDetails = { truncated: true }
            }
          } catch {
            boundedDetails = { truncated: true }
          }
        }

        const payload = {
          userId: userId || request?.user?._id || request?.user?.id || null,
          action,
          resourceType,
          resourceId,
          requestId: request?.id || null,
          ipAddress: request?.ip || null,
          createdAt: instantToDate(nowInstant()),
        }

        if (boundedDetails !== undefined) {
          payload.details = boundedDetails
        }

        const auditWrite = new Promise((resolve) => {
          setImmediate(async () => {
            try {
              await auditLogs.insertOne(payload)
            } catch (err) {
              request?.log?.warn(
                { err, action, resourceType, resourceId },
                'Failed to write audit event',
              )
            } finally {
              resolve()
            }
          })
        })

        trackAuditWrite(auditWrite)
      },
    )

    fastify.log.info('Successfully registered audit plugin')
  },
  {
    name: 'audit-plugin',
    dependencies: ['db-plugin'],
    decorators: {
      fastify: ['mongo'],
    },
  },
)

module.exports = Object.assign(auditPlugin, {
  flushAuditLogs,
})
