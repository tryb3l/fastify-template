'use strict'
const fp = require('fastify-plugin')
const cookies = require('@fastify/cookie')

module.exports = fp(async function cookiePlugin(fastify) {
  fastify.register(cookies, {
    secret: 'my-secret',
    parseOptions: {
      path: '/',
      maxAge: 60 * 60 * 24,
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      signed: true,
    },
  })
})
