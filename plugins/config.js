'use strict'

const fp = require('fastify-plugin')
const fastifyEnv = require('@fastify/env')

module.exports = fp(
  async function registerPluginsAndConfig(fastify, opts) {
    if (fastify.hasDecorator('secrets')) {
      return
    }

    await fastify.register(fastifyEnv, {
      confKey: 'secrets',
      data: opts.configData,
      schema: fastify.getSchema('schema:dotenv'),
    })

    fastify.log.level = fastify.secrets.LOG_LEVEL

    fastify.decorate('config', {
      jwt: {
        secret: fastify.secrets.JWT_SECRET,
        accessExpireIn: fastify.secrets.JWT_EXPIRE_IN,
        refreshExpireIn: fastify.secrets.JWT_REFRESH_EXPIRE_IN,
      },
      cookie: {
        secret: fastify.secrets.COOKIE_SECRET,
        accessMaxAge: fastify.secrets.COOKIE_ACCESS_MAX_AGE,
        refreshMaxAge: fastify.secrets.COOKIE_REFRESH_MAX_AGE,
      },
    })
  },

  { name: 'application-config', dependencies: ['application-schemas'] },
)
