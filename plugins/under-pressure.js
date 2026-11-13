'use strict'

const fp = require('fastify-plugin')
const v8 = require('node:v8')
const underPressure = require('@fastify/under-pressure')

const DEFAULT_MAX_HEAP_USED_BYTES = 750_000_000
const DEFAULT_MAX_RSS_BYTES = 1_200_000_000

function resolveUnderPressureThresholds(config = {}) {
  const maxHeapUsedBytes =
    Number(config.MAX_HEAP_USED_BYTES ?? process.env.MAX_HEAP_USED_BYTES) ||
    DEFAULT_MAX_HEAP_USED_BYTES
  const maxRssBytes =
    Number(config.MAX_RSS_BYTES ?? process.env.MAX_RSS_BYTES) || DEFAULT_MAX_RSS_BYTES

  return {
    maxHeapUsedBytes,
    maxRssBytes,
  }
}

const underPressurePlugin = fp(
  async function underPressurePlugin(fastify) {
    fastify.log.info('Starting registration of under-pressure plugin')

    const { maxHeapUsedBytes, maxRssBytes } = resolveUnderPressureThresholds(fastify.config)

    await fastify.register(underPressure, {
      maxEventLoopDelay: 1000,
      maxHeapUsedBytes,
      maxRssBytes,
      maxEventLoopUtilization: 0.98,

      message: 'Server is currently under heavy load. Please try again later.',
      retryAfter: 50,

      exposeStatusRoute: {
        url: '/health',
        routeResponseSchemaOpts: {
          database: { type: 'string' },
          memory: { type: 'number' },
        },
        routeOpts: {
          logLevel: 'silent',
        },
      },

      healthCheck: async function (fastifyInstance) {
        try {
          await fastifyInstance.mongo.db.command({ ping: 1 })
          return {
            status: 'ok',
            database: 'connected',
            memory: v8.getHeapStatistics().used_heap_size,
          }
        } catch (err) {
          fastifyInstance.log.error({ err }, 'Health check failed: MongoDB unreachable')
          return false
        }
      },
      healthCheckInterval: 5000,
    })

    fastify.log.info('Successfully registered under-pressure plugin')
  },
  {
    name: 'under-pressure',
    dependencies: ['application-config', 'db-plugin'],
    decorators: { fastify: ['config', 'mongo'] },
  },
)

module.exports = Object.assign(underPressurePlugin, {
  resolveUnderPressureThresholds,
})
