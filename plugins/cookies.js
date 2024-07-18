'use strict'
const fp = require('fastify-plugin')
const cookie = require('@fastify/cookie')

module.exports = fp(
  async function cookiePlugin(fastify) {
    fastify.register(cookie, {
      secret: fastify.secrets.COOKIE_SECRET || 'my-secret',
      parseOptions: {
        path: '/',
        maxAge: fastify.secrets.COOKIE_MAX_AGE || 1800000,
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
        signed: true,
      },
    })
  },
  { name: 'cookie-plugin', dependencies: ['application-config'] },
)
