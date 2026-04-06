'use strict'

const fp = require('fastify-plugin')
const fastifyJwt = require('@fastify/jwt')
const { randomUUID } = require('node:crypto')

function tagUnauthorizedError(error, authErrorCode) {
  error.authErrorCode = authErrorCode
  return error
}

module.exports = fp(async function (fastify) {
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
        return null;
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

  fastify.decorate('authenticate', async function (request, reply) {
    fastify.log.info('Entering authenticate method')
    try {
      const decoded = await request.jwtVerify()
      request.log.debug({ decoded }, 'Token decoded successfully')

      if (decoded.type !== 'access') {
        throw fastify.httpErrors.unauthorized('Invalid access token type')
      }

      const user = await fastify.usersDataSource.readUserById(decoded.sub)
      if (!user) {
        request.log.error({ userId: decoded.sub }, 'User not found')
        throw fastify.httpErrors.unauthorized('User not found')
      }

      const userCredentialsVersion = user.credentialsVersion ?? 0
      const tokenCredentialsVersion = decoded.cv ?? 0

      if (userCredentialsVersion !== tokenCredentialsVersion) {
        request.log.warn({ userId: decoded.sub }, 'Session invalidated due to credentials version mismatch')
        throw tagUnauthorizedError(
          fastify.httpErrors.unauthorized('Session invalidated'),
          'AUTH_SESSION_INVALIDATED'
        )
      }

      request.user = user
    } catch (err) {
      request.log.error({ err }, 'Authentication failed')

      if (err.code === 'FST_JWT_AUTHORIZATION_TOKEN_EXPIRED') {
        throw fastify.httpErrors.unauthorized('Token expired')
      }

      if (err.authErrorCode === 'AUTH_SESSION_INVALIDATED') {
        throw err
      }

      throw fastify.httpErrors.unauthorized('Authentication required')
    }
    fastify.log.info('Exiting authenticate method')
  })

  fastify.decorate('authorize', function (allowedRoles) {
    return async function (request, reply) {
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

    const accessToken = await fastify.jwt.sign(
      { ...payload, type: 'access' },
      {
        jti: randomUUID(),
        expiresIn: fastify.config.jwt.accessExpireIn || '1h',
      }
    )

    const refreshToken = await fastify.jwt.sign(
      { ...payload, type: 'refresh' },
      {
        jti: randomUUID(),
        expiresIn: fastify.config.jwt.refreshExpireIn || '30d',
      }
    )

    fastify.log.info('Exiting generateTokens method')
    return { accessToken, refreshToken }
  })

  fastify.decorateRequest('revokeToken', async function (jti, exp, userId) {
    fastify.log.info('Entering revokeToken method')
    try {
      await fastify.usersDataSource.revokeToken(jti, exp, userId)
      fastify.log.info({ jti }, 'Token revoked successfully')
    } catch (error) {
      fastify.log.error({ error, jti }, 'Error revoking token')
      throw error
    }
  })

  fastify.decorate('verifyRefreshToken', async function (request, reply) {
    fastify.log.info('Entering verifyRefreshToken method')
    try {
      const token = request.cookies?.refreshToken;

      if (!token) {
        throw fastify.httpErrors.unauthorized('No refresh token provided');
      }

      const decoded = await fastify.jwt.verify(token);

      if (decoded.type !== 'refresh') {
        throw fastify.httpErrors.unauthorized('Invalid refresh token type')
      }

      const isRevoked = await fastify.usersDataSource.checkIfRevoked(decoded.jti)
      if (isRevoked) {
        throw fastify.httpErrors.unauthorized('Refresh token has been revoked')
      }

      const user = await fastify.usersDataSource.readUserById(decoded.sub)
      if (!user) {
        throw fastify.httpErrors.unauthorized('User not found')
      }

      const userCredentialsVersion = user.credentialsVersion ?? 0
      const tokenCredentialsVersion = decoded.cv ?? 0

      if (userCredentialsVersion !== tokenCredentialsVersion) {
        throw tagUnauthorizedError(
          fastify.httpErrors.unauthorized('Refresh token session invalidated'),
          'AUTH_REFRESH_SESSION_INVALIDATED'
        )
      }

      request.user = user
      request.refreshTokenId = decoded.jti
      request.refreshTokenExp = decoded.exp
    } catch (err) {
      request.log.error({ err }, 'Verify refresh token failed')

      if (err.authErrorCode === 'AUTH_REFRESH_SESSION_INVALIDATED') {
        throw err
      }

      throw fastify.httpErrors.unauthorized('Invalid refresh token')
    }
  })

  fastify.log.info('Successfully registered auth plugin')
}, {
  name: 'authentication-plugin',
  dependencies: ['application-config', 'cookie-plugin', 'users-store'],
  decorators: {
    fastify: ['config']
  }
})