'use strict'

const fp = require('fastify-plugin')
const fastifyJwt = require('@fastify/jwt')
const fastifySession = require('@fastify/session')

module.exports = fp(
  async function authenticationPlugin(fastify) {
    const revokedTokens = new Map()

    fastify.register(fastifySession, {
      secret: fastify.secrets.SESSION_SECRET,
      cookie: {
        cookieName: 'sessionId',
        signed: true,
      },
    })

    fastify.register(fastifyJwt, {
      secret: fastify.secrets.JWT_SECRET,
      cookie: {
        cookieName: 'token',
        signed: true,
      },
      trusted: function isTrusted(request, decodedToken) {
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
      reply.clearCookie('token')
    })

    fastify.decorateRequest('generateToken', async function (reply) {
      const token = fastify.jwt.sign(
        {
          id: String(this.user._id),
          username: this.user.username,
        },
        {
          jti: String(Date.now()),
          expiresIn: fastify.secrets.JWT_EXPIRE_IN,
        },
      )

      reply.setCookie('token', token, {
        path: '/',
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
        maxAge: fastify.secrets.COOKIE_MAX_AGE,
        signed: true,
      })

      reply.setCookie('sessionId', this.session.sessionId, {
        path: '/',
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
        maxAge: fastify.secrets.SESSION_MAX_AGE,
        signed: true,
      })

      return token
    })
  },
  {
    name: 'authentication-plugin',
    dependencies: ['application-config', 'cookie-plugin'],
  },
)
