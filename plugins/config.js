'use strict'

const fp = require('fastify-plugin')
const fastifyEnv = require('@fastify/env')
const envSchema = require('../schemas/dotenv.json')

module.exports = fp(
  async function registerPluginsAndConfig(fastify, opts) {
    fastify.log.info("Registering 'application-config' plugin");

    if (fastify.hasDecorator('secrets')) {
      fastify.log.warn("'application-config' already registered, skipping");
      return
    }

    fastify.log.debug("Registering '@fastify/env'");
    await fastify.register(fastifyEnv, {
      confKey: 'secrets',
      data: opts.configData,
      schema: envSchema,
    })
    fastify.log.debug("'@fastify/env' registered successfully");

    fastify.log.level = fastify.secrets.LOG_LEVEL
    fastify.log.info(`Log level set to: ${fastify.log.level}`);

    fastify.decorate('config', {
      NODE_ENV: fastify.secrets.NODE_ENV,
      MONGO_URL: fastify.secrets.MONGO_URL,
      FRONTEND_URL: fastify.secrets.FRONTEND_URL || 'http://localhost:5173',

      ADMIN_EMAIL: fastify.secrets.ADMIN_EMAIL,
      ADMIN_PASSWORD: fastify.secrets.ADMIN_PASSWORD,

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

    fastify.log.info("'config' decorator added successfully");
  },
  { name: 'application-config', dependencies: [] },
)