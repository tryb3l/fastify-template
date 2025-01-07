const fp = require('fastify-plugin')
const cookie = require('@fastify/cookie')

module.exports = fp(
  async function cookiePlugin(fastify) {
    fastify.log.info('Starting registration of cookie plugin')

    try {
      await fastify.register(cookie, {
        secret: fastify.config.cookie.secret,
        hook: 'onRequest',
        parseOptions: {
          secure: process.env.NODE_ENV === 'production',
          httpOnly: true,
          sameSite: 'lax',
          signed: false
        }
      })
      fastify.log.info('Successfully registered cookie plugin')
    } catch (err) {
      fastify.log.error('Error registering cookie plugin:', err)
      throw err
    }
  },
  { name: 'cookie-plugin', dependencies: ['application-config'] }
)