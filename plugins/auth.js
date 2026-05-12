'use strict'

const fp = require('fastify-plugin')
const fastifyJwt = require('@fastify/jwt')
const { randomUUID } = require('node:crypto')

module.exports = fp(
  async function (fastify) {
    fastify.log.info('Starting registration of auth plugin')

    const jwtConfig = {
      secret: fastify.config.jwt.secret,
      sign: {
        expiresIn: fastify.config.jwt.accessExpireIn || '1h',
      },
      verify: {
        extractToken: (req) => {
          if (req.headers.authorization?.startsWith('Bearer ')) {
            return req.headers.authorization.substring(7)
          }
          return null
        },
      },
      messages: {
        badRequestErrorMessage: 'Format is Authorization: Bearer [token]',
        noAuthorizationInHeaderMessage: 'No Authorization was found in request.headers',
        authorizationTokenExpiredMessage: 'Authorization token expired',
        authorizationTokenInvalid: (err) => `Authorization token is invalid: ${err.message}`,
      },
    }

    await fastify.register(fastifyJwt, jwtConfig)

    fastify.decorate('authenticate', async function (request) {
      fastify.log.info('Entering authenticate method')

      let decoded
      try {
        decoded = await request.jwtVerify()
      } catch (err) {
        request.log.error({ err }, 'Authentication failed')

        if (err.code === 'FST_JWT_AUTHORIZATION_TOKEN_EXPIRED') {
          throw fastify.httpErrors.unauthorized('Token expired')
        }

        throw fastify.httpErrors.unauthorized('Authentication required')
      }

      request.log.debug({ decoded }, 'Token decoded successfully')

      if (decoded.type !== 'access') {
        request.log.warn(
          { tokenType: decoded.type },
          'Rejecting token with invalid access token type',
        )
        throw fastify.httpErrors.unauthorized('Authentication required')
      }

      const user = await fastify.usersDataSource.readUserById(decoded.sub)
      if (!user) {
        request.log.warn({ userId: decoded.sub }, 'User not found during authentication')
        throw fastify.httpErrors.unauthorized('Authentication required')
      }

      const userCredentialsVersion = user.credentialsVersion ?? 0
      const tokenCredentialsVersion = decoded.cv ?? 0

      if (userCredentialsVersion !== tokenCredentialsVersion) {
        request.log.warn(
          { userId: decoded.sub },
          'Session invalidated due to credentials version mismatch',
        )
        throw fastify.httpErrors.unauthorized('Session invalidated')
      }

      request.user = user
      fastify.log.info('Exiting authenticate method')
    })

    fastify.decorate('authorize', function (allowedRoles) {
      return async function (request) {
        fastify.log.info('Entering authorize method')
        if (!request.user || !allowedRoles.includes(request.user.role)) {
          throw fastify.httpErrors.forbidden('You are not authorized to access this resource')
        }
        fastify.log.info('Exiting authorize method')
      }
    })

    fastify.decorateRequest('generateTokens', async function (user) {
      fastify.log.info('Entering generateTokens method')
      const payload = {
        sub: user._id,
        username: user.username,
        role: user.role,
        cv: user.credentialsVersion ?? 0,
      }

      const accessToken = fastify.jwt.sign(
        { ...payload, type: 'access' },
        {
          jti: randomUUID(),
          expiresIn: fastify.config.jwt.accessExpireIn || '1h',
        },
      )

      const refreshToken = fastify.jwt.sign(
        { ...payload, type: 'refresh' },
        {
          jti: randomUUID(),
          expiresIn: fastify.config.jwt.refreshExpireIn || '30d',
        },
      )

      fastify.log.info('Exiting generateTokens method')
      return { accessToken, refreshToken }
    })

    fastify.decorateRequest('revokeToken', async function (jti, exp, userId) {
      fastify.log.info('Entering revokeToken method')
      await fastify.usersDataSource.revokeToken(jti, exp, userId)
      fastify.log.info({ jti }, 'Token revoked successfully')
    })

    fastify.decorate('verifyRefreshToken', async function (request) {
      fastify.log.info('Entering verifyRefreshToken method')
      const token = request.cookies?.refreshToken

      if (!token) {
        request.log.warn('Missing refresh token cookie')
        throw fastify.httpErrors.unauthorized('Invalid refresh token')
      }

      let decoded
      try {
        decoded = await fastify.jwt.verify(token)
      } catch (err) {
        request.log.error({ err }, 'Verify refresh token failed')
        throw fastify.httpErrors.unauthorized('Invalid refresh token')
      }

      if (decoded.type !== 'refresh') {
        request.log.warn(
          { tokenType: decoded.type },
          'Rejecting token with invalid refresh token type',
        )
        throw fastify.httpErrors.unauthorized('Invalid refresh token')
      }

      const isRevoked = await fastify.usersDataSource.checkIfRevoked(decoded.jti)
      if (isRevoked) {
        request.log.warn({ jti: decoded.jti }, 'Rejected revoked refresh token')
        throw fastify.httpErrors.unauthorized('Invalid refresh token')
      }

      const user = await fastify.usersDataSource.readUserById(decoded.sub)
      if (!user) {
        request.log.warn(
          { userId: decoded.sub },
          'User not found during refresh token verification',
        )
        throw fastify.httpErrors.unauthorized('Invalid refresh token')
      }

      const userCredentialsVersion = user.credentialsVersion ?? 0
      const tokenCredentialsVersion = decoded.cv ?? 0

      if (userCredentialsVersion !== tokenCredentialsVersion) {
        throw fastify.httpErrors.unauthorized('Refresh token session invalidated')
      }

      request.user = user
      request.refreshTokenId = decoded.jti
      request.refreshTokenExp = decoded.exp
    })

    fastify.log.info('Successfully registered auth plugin')
  },
  {
    name: 'authentication-plugin',
    dependencies: ['application-config', 'cookie-plugin', 'users-store'],
    decorators: {
      fastify: ['config'],
    },
  },
)
