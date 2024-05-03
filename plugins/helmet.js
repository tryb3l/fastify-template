'use strict'

const fp = require('fastify-plugin')

module.exports = fp(async function helmetPlugin(fastify) {
  fastify.register(require('@fastify/helmet'), {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", 'https:', "'unsafe-inline'"],
        scriptSrc: ["'self'", 'https:', "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'validator.swagger.io'],
      },
    },
  })
})
