'use strict'

const generateHash = require('../auth/generate-hash')

module.exports = async function authRoutes(fastify) {

  fastify.post('/register', {
    schema: {
      tags: ['auth'],
      summary: 'Register a new user',
      body: { $ref: 'schema:auth:register#' }, 
      response: {
        201: {
          type: 'object',
          properties: { registered: { type: 'boolean' } }
        }
      }
    },
    handler: async function registerHandler(request, reply) {
      const existingUser = await fastify.usersDataSource.readUser(
        request.body.username,
        request.body.email,
      )
      
      if (existingUser) {
        throw fastify.httpErrors.conflict('User already registered')
      }

      const { hash, salt } = await generateHash(request.body.password)

      const newUserId = await fastify.usersDataSource.createUser({
        username: request.body.username,
        email: request.body.email,
        salt,
        hash,
        role: 'user',
      })

      request.log.info({ userId: newUserId }, 'User registered')
      reply.code(201)
      return { registered: true }
    },
  })

  fastify.post('/authenticate', {
    schema: {
      tags: ['auth'],
      summary: 'Authenticate a user',
      body: { $ref: 'schema:auth:authenticate#' },
      response: {
        200: {
          type: 'object',
          properties: {
            accessToken: { type: 'string' },
            refreshToken: { type: 'string' },
            user: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                username: { type: 'string' },
                role: { type: 'string' }
              }
            }
          }
        }
      }
    },
    handler: async function authenticateHandler(request, reply) {
      const user = await fastify.usersDataSource.readUser(request.body.username)
      if (!user) {
        throw fastify.httpErrors.unauthorized('Invalid credentials')
      }

      const { hash } = await generateHash(request.body.password, user.salt)
      if (hash !== user.hash) {
        throw fastify.httpErrors.unauthorized('Invalid credentials')
      }

      const { accessToken, refreshToken } = await request.generateTokens(user)

      const cookieOptions = {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        signed: false,
      }

      reply
        .setCookie('accessToken', accessToken, {
          ...cookieOptions,
          maxAge: fastify.config.cookie.accessMaxAge
        })
        .setCookie('refreshToken', refreshToken, {
          ...cookieOptions,
          maxAge: fastify.config.cookie.refreshMaxAge
        })

      return {
        accessToken: accessToken,
        refreshToken: refreshToken,
        user: {
          id: user._id,
          username: user.username,
          role: user.role
        }
      }
    }
  })

  fastify.post('/refresh', {
    onRequest: fastify.verifyRefreshToken,
    schema: {
      tags: ['auth'],
      summary: 'Refresh access token',
      description: 'Uses the httpOnly refresh cookie to generate a new access token.'
    },
    handler: async function refreshHandler(request, reply) {
      await fastify.revokeToken(request.refreshTokenId)
      const { accessToken, refreshToken } = await request.generateTokens(request.user)

      const cookieOptions = {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        signed: false,
      };

      reply
        .setCookie('accessToken', accessToken, {
          ...cookieOptions,
          maxAge: fastify.config.cookie.accessMaxAge
        })
        .setCookie('refreshToken', refreshToken, {
          ...cookieOptions,
          maxAge: fastify.config.cookie.refreshMaxAge
        })

      return {
        accessToken,
        refreshToken,
        status: 'token_refreshed'
      }
    }
  })

  fastify.post('/logout', {
    onRequest: fastify.verifyRefreshToken,
    schema: {
      tags: ['auth'],
      summary: 'Logout the current user',
    },
    handler: async function logoutHandler(request, reply) {
      await fastify.revokeToken(request.refreshTokenId);

      reply
        .clearCookie('accessToken', { path: '/' })
        .clearCookie('refreshToken', { path: '/' });

      reply.code(204).send()
    },
  })
}