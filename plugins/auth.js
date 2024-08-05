'use strict'

const fp = require('fastify-plugin')
const fastifyJwt = require('@fastify/jwt')

module.exports = fp(
  async function authenticationPlugin(fastify) {
    const revokedTokens = new Map()

    fastify.register(
      fastifyJwt,
      {
        secret: fastify.config.jwt.secret,
        cookie: {
          cookieName: 'refreshToken',
          onlyCookie: true,
        },
      },
      {
        trusted: function isTrusted(decodedToken) {
          return !revokedTokens.has(decodedToken.jti)
        },
      },
    )

    fastify.decorate('authenticate', async function (request, reply) {
      try {
        await request.jwtVerify({ onlyCookie: true })
      } catch (err) {
        reply.send(err)
      }
    })

    fastify.decorateRequest('revokeToken', async function () {
      revokedTokens.set(this.user.jti, true)
    })

    fastify.decorateRequest('generateAccessToken', async function () {
      const accessToken = fastify.jwt.sign(
        {
          id: String(this.user._id),
          username: this.user.username,
        },
        {
          jti: String(Date.now()),
          expiresIn: fastify.config.jwt.accessExpireIn,
        },
      )
      console.log('generateAccessToken -> accessToken ', accessToken)
      return accessToken
    })

    fastify.decorateRequest('generateRefreshToken', async function () {
      const refreshToken = fastify.jwt.sign(
        {
          id: String(this.user._id),
          username: this.user.username,
        },
        {
          jti: String(Date.now()),
          expiresIn: fastify.config.jwt.refreshExpireIn,
        },
      )
      console.log('generateRefreshToken -> refreshToken ', refreshToken)
      return refreshToken
    })
  },
  {
    name: 'authentication-plugin',
    dependencies: ['application-config', 'cookie-plugin'],
  },
)
