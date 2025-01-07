'use strict'

const fp = require('fastify-plugin')
const generateHash = require('../auth/generate-hash')

module.exports = fp(async function authRoutes(fastify) {

  fastify.post('/register', {
    schema: {
      tags: ['auth'],
      summary: 'Register a new user',
      body: fastify.getSchema('schema:auth:register'),
      response: {
        201: {
          type: 'object',
          properties: {
            registered: { type: 'boolean' }
          }
        },
        409: {
          type: 'object',
          properties: {
            statusCode: { type: 'integer' },
            error: { type: 'string' },
            message: { type: 'string' }
          }
        }
      }
    },
    handler: async function registerHandler(request, reply) {
      const existingUser = await fastify.usersDataSource.readUser(
        request.body.username,
        request.body.email,
      )
      if (existingUser) {
        const err = new Error('User already registered')
        err.statusCode = 409
        throw err
      }

      const { hash, salt } = await generateHash(request.body.password)

      try {
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
      } catch (error) {
        request.log.error(error, 'Failed to register user')
        reply.code(500)
        return { registered: false }
      }
    },
  })

  fastify.post('/authenticate', {
    schema: {
      tags: ['auth'],
      summary: 'Authenticate a user',
      body: fastify.getSchema('schema:auth:authenticate'),
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

      // Generate both access and refresh tokens
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
    handler: async function refreshHandler(request, reply) {
      // Revoke old refresh token
      await fastify.revokeToken(request.refreshTokenId)

      // Generate new tokens
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

      // Return new access token
      return {
        accessToken,
        refreshToken,
        status: 'token_refreshed'
      }
    }
  })

  // fastify.get('/me', {
  //   onRequest: fastify.authenticate,
  //   schema: {
  //     tags: ['auth'],
  //     summary: 'Get current user details',
  //     headers: fastify.getSchema('auth/schemas/schema:auth:token-header'),
  //     response: {
  //       200: {
  //         type: 'object',
  //         properties: {
  //           data: {
  //             $ref: 'auth/schemas/schema:user#',
  //           },
  //         },
  //       },
  //     },
  //   },
  //   handler: async function meHandler(request, reply) {
  //     const user = request.user
  //     if (!user) {
  //       throw fastify.httpErrors.notFound('User not found')
  //     }
  //     return { data: user }
  //   },
  // })

  fastify.post('/logout', {
    onRequest: fastify.authenticate,
    schema: {
      tags: ['auth'],
      summary: 'Logout the current user',
      querystring: fastify.getSchema('schema:auth:token-header'),
    },
    handler: async function logoutHandler(request, reply) {
      await fastify.revokeToken(request.refreshTokenId);
      reply.code(204)
    },

  })
},
  {
    name: 'auth-routes',
    dependencies: ['authentication-plugin', 'users-store'],
    encapsulate: true,
  },
)