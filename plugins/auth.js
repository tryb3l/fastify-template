'use strict'

const fp = require('fastify-plugin')
const fastifyJwt = require('@fastify/jwt')

module.exports = fp(
  async function authenticationPlugin(fastify) {
    const revokedTokens = new Map()

    fastify.register(fastifyJwt, {
      secret: fastify.secrets.JWT_SECRET,
      trusted: function isTrusted(decodedToken) {
        return !revokedTokens.has(decodedToken.jti)
      },
    })

    fastify.decorate('authenticate', async function authenticate(request, reply) {
      try {
        await request.jwtVerify()
      } catch (err) {
        reply.send(err)
      }
    })

    fastify.decorateRequest('revokeToken', async function (request, reply) {
      revokedTokens.set(this.user.jti, true)
      reply.clearCookie('accessToken')
      reply.clearCookie('refreshToken')
    })

    fastify.decorateRequest('generateAccessToken', async function (reply) {
      const token = fastify.jwt.sign(
        {
          id: String(this.user._id),
          username: this.user.username,
        },
        {
          jti: String(Date.now()),
          expiresIn: fastify.config.jwt.accessExpireIn,
        },
      )

      reply.setCookie('accessToken', token, { maxAge: fastify.config.cookie.accessMaxAge })

      return token
    })

    fastify.decorateRequest('generateRefreshToken', async function (reply) {
      const token = fastify.jwt.sign(
        {
          id: String(this.user._id),
          username: this.user.username,
        },
        {
          jti: String(Date.now()),
          expiresIn: fastify.config.jwt.refreshExpireIn,
        },
      )

      reply.setCookie('refreshToken', token, { maxAge: fastify.config.cookie.refreshMaxAge })

      return token
    })
  },
  {
    name: 'authentication-plugin',
    dependencies: ['application-config', 'cookie-plugin'],
  },
)
