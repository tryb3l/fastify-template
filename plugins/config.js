'use strict'

const fp = require('fastify-plugin')
const fastifyEnv = require('@fastify/env')
const envSchema = require('../schemas/dotenv.json')

module.exports = fp(
  async function registerPluginsAndConfig(fastify, opts) {
    console.log("Registering 'application-config' plugin"); // Log at start

    if (fastify.hasDecorator('secrets')) {
      console.log("'application-config' already registered, skipping");
      return
    }

    console.log("Registering '@fastify/env'");
    await fastify.register(fastifyEnv, {
      confKey: 'secrets',
      data: opts.configData,
      schema: envSchema,
    })
    console.log("'@fastify/env' registered successfully");

    console.log("Setting log level to:", fastify.secrets.LOG_LEVEL);
    fastify.log.level = fastify.secrets.LOG_LEVEL

    console.log("Decorating Fastify instance with 'config'");
    fastify.decorate('config', {
      jwt: {
        secret: fastify.secrets.JWT_SECRET,
        accessExpireIn: fastify.secrets.JWT_EXPIRE_IN || '1h',
        refreshExpireIn: fastify.secrets.JWT_REFRESH_EXPIRE_IN || '30d',
      },
      cookie: {
        secret: fastify.secrets.COOKIE_SECRET,
        accessMaxAge: fastify.secrets.COOKIE_ACCESS_MAX_AGE,
        refreshMaxAge: fastify.secrets.COOKIE_REFRESH_MAX_AGE,
      },
    })
    console.log("'config' decorator added successfully");

    console.log("Finished registering 'application-config' plugin");
  },

  { name: 'application-config', dependencies: [] },
)