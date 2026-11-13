'use strict'

const fp = require('fastify-plugin')
const fastifyMongo = require('@fastify/mongodb')

const DEFAULT_MAX_POOL_SIZE = 20
const DEFAULT_MIN_POOL_SIZE = 2

function resolveMongoPoolOptions(config = {}) {
  const rawMax = Number(config.MONGO_MAX_POOL_SIZE ?? DEFAULT_MAX_POOL_SIZE)
  const maxPoolSize = Number.isFinite(rawMax)
    ? Math.max(1, Math.trunc(rawMax))
    : DEFAULT_MAX_POOL_SIZE

  const rawMin = Number(config.MONGO_MIN_POOL_SIZE ?? DEFAULT_MIN_POOL_SIZE)
  const clampedMin = Number.isFinite(rawMin)
    ? Math.max(0, Math.trunc(rawMin))
    : DEFAULT_MIN_POOL_SIZE
  const minPoolSize = Math.min(maxPoolSize, clampedMin)

  return { maxPoolSize, minPoolSize }
}

const dbPlugin = fp(
  async function dbPlugin(fastify) {
    fastify.log.info("Registering 'db-plugin' plugin")
    fastify.log.debug(`Attempting to connect to MongoDB at: ${fastify.config.MONGO_URL}`)

    const { maxPoolSize, minPoolSize } = resolveMongoPoolOptions(fastify.config)

    try {
      await fastify.register(fastifyMongo, {
        serverSelectionTimeoutMS: 5000,
        forceClose: true,
        url: fastify.config.MONGO_URL,
        maxPoolSize,
        minPoolSize,
      })
      fastify.log.info("'db-plugin' registered successfully")
    } catch (err) {
      fastify.log.error({ err }, "Error registering 'db-plugin'")
      throw err
    }
  },
  {
    name: 'db-plugin',
    dependencies: ['application-config'],
    decorators: {
      fastify: ['config'],
    },
  },
)

Object.defineProperty(dbPlugin, 'resolveMongoPoolOptions', {
  value: resolveMongoPoolOptions,
  enumerable: false,
})

module.exports = dbPlugin
