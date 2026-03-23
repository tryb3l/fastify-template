'use strict'

const fp = require('fastify-plugin')
const fastifyJwt = require('@fastify/jwt')
const { randomUUID } = require('node:crypto')

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
        return req.cookies?.accessToken
      },
    },
    messages: {
      badRequestErrorMessage: 'Format is Authorization: Bearer [token]',
      noAuthorizationInHeaderMessage: 'No Authorization was found in request.headers',
      authorizationTokenExpiredMessage: 'Authorization token expired',
      authorizationTokenInvalid: (err) => `Authorization token is invalid: ${err.message}`,
    },
  }

  fastify.log.info('JWT configuration:', jwtConfig)

  await fastify.register(fastifyJwt, jwtConfig)

  fastify.decorate('authenticate', async function (request, reply) {
    fastify.log.info('Entering authenticate method')
    try {
      const decoded = await request.jwtVerify()
      request.log.debug({ decoded }, 'Token decoded successfully')

      const user = await fastify.usersDataSource.readUserById(decoded.sub)
      if (!user) {
        request.log.error({ userId: decoded.sub }, 'User not found')
        throw fastify.httpErrors.unauthorized('User not found')
      }

      request.user = user
    } catch (err) {
      request.log.error(
        {
          err,
          headers: request.headers,
          cookies: request.cookies,
          stack: err.stack,
        },
        'Authentication failed'
      )
      reply.send(fastify.httpErrors.unauthorized('Authentication required'))
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

  fastify.decorateRequest('revokeToken', async function (jti) {
    fastify.log.info('Entering revokeToken method')
    try {
      await fastify.usersDataSource.revokeToken(jti)
      fastify.log.info({ jti }, 'Token revoked successfully')
    } catch (error) {
      fastify.log.error({ error, jti }, 'Error revoking token')
      throw error
    }
    fastify.log.info('Exiting revokeToken method')
  })

  fastify.decorate('verifyRefreshToken', async function (request, reply) {
    fastify.log.info('Entering verifyRefreshToken method')
    try {
      const token = request.cookies?.refreshToken || request.body?.refreshToken;

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

      request.user = user
      request.refreshTokenId = decoded.jti
    } catch (err) {
      request.log.error({ err }, 'Verify refresh token failed')
      throw fastify.httpErrors.unauthorized('Invalid refresh token')
    }
  })

  fastify.decorate('addUserIdHook', async function addUserIdHook(request, reply) {
    if (request.user && request.user.id) {
      const methodsToDecorate = [
        'countNotes',
        'listNotes',
        'createNote',
        'createNotes',
        'readNote',
        'updateNote',
        'deleteNote',
      ];

      methodsToDecorate.forEach(method => {
        request.notesDataSource[method] = async function (...args) {
          return fastify.notesDataSource[method](...args, request.user.id);
        };
      });
    }
  })

  fastify.log.info('Successfully registered auth plugin')
}, {
  name: 'authentication-plugin',
  dependencies: ['application-config', 'cookie-plugin', 'users-store'],
})