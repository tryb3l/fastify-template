'use strict'

const fp = require('fastify-plugin')
const fastifyJwt = require('@fastify/jwt')
const { randomUUID } = require('node:crypto')

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

        const user = await fastify.usersDataSource.readUserById(request.user.sub)
        if (!user) {
          throw fastify.httpErrors.unauthorized('User not found')
        }
        request.user = user
      } catch (err) {
        throw fastify.httpErrors.unauthorized(err.message)
      }
    })

    fastify.decorate('authorize', function (allowedRoles) {
      return async function (request, reply) {
        if (!allowedRoles.includes(request.user.role)) {
          request.log.warn(
            {
              userId: request.user._id,
              userRole: request.user.role,
              requiredRoles: allowedRoles,
            },
            'Insufficient permissions',
          )
          throw fastify.httpErrors.forbidden('Insufficient permissions')
        }
        request.log.info(
          {
            userId: request.user._id,
            userRole: request.user.role,
          },
          'Authorization successful',
        )
      }
    })

    fastify.decorateRequest('revokeToken', async function () {
      const tokenId = this.user.jti
      revokedTokens.set(tokenId, true)
      this.log.info({ tokenId }, 'Token revoked')
    })

    fastify.decorateRequest('generateAccessToken', async function () {
      const accessToken = fastify.jwt.sign(
        {
          sub: String(this.user._id),
          aud: 'access',
          iss: 'fastify-api',
        },
        {
          jti: randomUUID(),
          expiresIn: fastify.config.jwt.accessExpireIn,
        },
      )

      return accessToken
    })

    fastify.decorateRequest('generateRefreshToken', async function () {
      const refreshToken = fastify.jwt.sign(
        {
          sub: String(this.user._id),
          aud: 'refresh',
          iss: 'fastify-api',
        },
        {
          jti: randomUUID(),
          expiresIn: fastify.config.jwt.refreshExpireIn,
        },
      )

      return refreshToken
    })
  },
  {
    name: 'authentication-plugin',
    dependencies: ['application-config', 'cookie-plugin'],
  },
)
