'use strict'

const fp = require('fastify-plugin')
const fastifyMongo = require('@fastify/mongodb')

module.exports = fp(
  async function dbPlugin(fastify) {
    fastify.log.info("Registering 'db-plugin' plugin")
    fastify.log.debug(`Attempting to connect to MongoDB at: ${fastify.config.MONGO_URL}`)

    try {
      await fastify.register(fastifyMongo, {
        serverSelectionTimeoutMS: 5000,
        forceClose: true,
        url: fastify.config.MONGO_URL,
        maxPoolSize: 20,
        minPoolSize: 10,
      })
      fastify.log.info("'db-plugin' registered successfully")
    } catch (err) {
      fastify.log.error({ err }, "Error registering 'db-plugin'");
      throw err;
    }
  },
  {
    name: 'db-plugin',
    dependencies: ['application-config'],
    decorators: {
      fastify: ['config']
    }
  },
)