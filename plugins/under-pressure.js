'use strict'

const fp = require('fastify-plugin')
const underPressure = require('@fastify/under-pressure')

module.exports = fp(async function underPressurePlugin(fastify, opts) {
    fastify.log.info('Starting registration of under-pressure plugin')

    await fastify.register(underPressure, {
        maxEventLoopDelay: 1000,
        maxHeapUsedBytes: 500_000_000,
        maxRssBytes: 500_000_000,
        maxEventLoopUtilization: 0.98,

        message: 'Server is currently under heavy load. Please try again later.',
        retryAfter: 50,

        exposeStatusRoute: {
            url: '/health',
            routeResponseSchemaOpts: {
                database: { type: 'string' },
                memory: { type: 'number' }
            },
            routeOpts: {
                logLevel: 'silent'
            }
        },

        healthCheck: async function (fastifyInstance) {
            try {
                await fastifyInstance.mongo.db.command({ ping: 1 })
                return { status: 'ok', database: 'connected', memory: process.memoryUsage().heapUsed }
            } catch (err) {
                fastifyInstance.log.error({ err }, 'Health check failed: MongoDB unreachable')
                return false
            }
        },
        healthCheckInterval: 5000
    })

    fastify.log.info('Successfully registered under-pressure plugin')
}, {
    name: 'under-pressure',
    dependencies: ['db-plugin']
})