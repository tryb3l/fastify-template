'use strict'

const fp = require('fastify-plugin')
const fastifyMongo = require('@fastify/mongodb')

module.exports = fp(
  async function datasourcePlugin(fastify) {
    fastify.register(fastifyMongo, {
      serverSelectionTimeoutMS: 5000,
      forceClose: true,
      url: fastify.secrets.MONGO_URL,
      maxPoolSize: 20,
      minPoolSize: 10,
    })
  },
  { dependencies: ['application-config'] },
)
