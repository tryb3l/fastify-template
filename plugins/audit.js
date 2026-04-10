'use strict'

const fp = require('fastify-plugin')

module.exports = fp(
  async function auditPlugin(fastify) {
    fastify.log.info('Starting registration of audit plugin')

    const auditLogs = fastify.mongo.db.collection('auditLogs')

    fastify.decorate(
      'auditLog',
      async function auditLog({ request, action, userId, resourceType, resourceId, details }) {
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
          createdAt: new Date(),
        }

        if (boundedDetails !== undefined) {
          payload.details = boundedDetails
        }

        setImmediate(() => {
          auditLogs.insertOne(payload).catch((err) => {
            request?.log?.warn(
              { err, action, resourceType, resourceId },
              'Failed to write audit event',
            )
          })
        })
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
