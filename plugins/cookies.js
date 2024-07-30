'use strict'
const fp = require('fastify-plugin')
const cookie = require('@fastify/cookie')

module.exports = fp(
  async function cookiePlugin(fastify) {
    fastify.register(cookie, {
      secret: fastify.config.cookie.secret,
      parseOptions: {
        path: '/',
        maxAge: fastify.config.cookie.maxAge || 1800000,
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
        signed: true,
      },
    })
  },
  { name: 'cookie-plugin', dependencies: ['application-config'] },
)
