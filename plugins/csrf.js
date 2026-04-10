'use strict'

const fp = require('fastify-plugin')
const fastifyCsrfProtection = require('@fastify/csrf-protection')

module.exports = fp(
  async function csrfPlugin(fastify) {
    fastify.log.info('Starting registration of csrf plugin')

    await fastify.register(fastifyCsrfProtection, {
      cookieOpts: {
        signed: false,
        httpOnly: true,
        sameSite: 'lax',
        secure: fastify.config.NODE_ENV === 'production',
      },
      sessionPlugin: '@fastify/cookie',
    })

    fastify.log.info('Successfully registered csrf plugin')
  },
  {
    name: 'csrf-plugin',
    dependencies: ['application-config', 'cookie-plugin'],
    decorators: { fastify: ['config'] },
  },
)
