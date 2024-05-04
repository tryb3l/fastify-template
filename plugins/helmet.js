'use strict'

const fp = require('fastify-plugin')

module.exports = fp(async function helmetPlugin(fastify) {
  fastify.register(require('@fastify/helmet'), {
    contentSecurityPolicy: {
      directives: {
        scriptSrc: ["'self'", 'trusted-cdn.com', 'https://unpkg.com'], // Adjust the CDN domain if needed
      },
    },
  })
})
