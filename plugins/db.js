'use strict'

const fp = require('fastify-plugin')
const fastifyMongo = require('@fastify/mongodb')

module.exports = fp(
  async function dbPlugin(fastify) {
    console.log("Registering 'db-plugin' plugin")
    try {
      await fastify.register(fastifyMongo, {
        serverSelectionTimeoutMS: 10000, // Increased timeout
        forceClose: true,
        url: fastify.secrets.MONGO_URL,
        maxPoolSize: 20,
        minPoolSize: 10,
      })
      console.log("'db-plugin' registered successfully")
    } catch (err) {
      console.error("Error registering 'db-plugin':", err);
      throw err;
    }

    console.log("Finished registering 'db-plugin' plugin")
  },
  {
    name: 'db-plugin',
    dependencies: ['application-config']
  },
)