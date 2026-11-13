'use strict'

const fp = require('fastify-plugin')
const { instantToDate, nowInstant } = require('../utils/time')

const pendingAuditWrites = new Set()

async function flushAuditLogs() {
  while (pendingAuditWrites.size > 0) {
    await Promise.allSettled(pendingAuditWrites)
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
        const log = request?.log || fastify.log
        const resolvedUserId = userId || request?.user?._id || request?.user?.id || null
        const requestId = request?.id || null
        const ipAddress = request?.ip || null
        const createdAt = instantToDate(nowInstant())

        const auditWrite = new Promise((resolve) => {
          setImmediate(async () => {
            try {
              let boundedDetails = null
              if (details !== undefined) {
                try {
                  const serialized = JSON.stringify(details)
                  boundedDetails = serialized.length <= 2048 ? details : { truncated: true }
                } catch {
                  boundedDetails = { truncated: true }
                }
              }

              await auditLogs.insertOne({
                userId: resolvedUserId,
                action,
                resourceType,
                resourceId,
                requestId,
                ipAddress,
                createdAt,
                details: boundedDetails,
              })
            } catch (err) {
              log.warn({ err, action, resourceType, resourceId }, 'Failed to write audit event')
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
