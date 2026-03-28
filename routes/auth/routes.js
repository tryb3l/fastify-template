'use strict'

const { generateHash, verifyPassword } = require('../auth/generate-hash')

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
      let userExists = false;

      if (request.body.username) {
        const byUsername = await fastify.usersDataSource.readUser(request.body.username)
        if (byUsername) userExists = true;
      }

      if (request.body.email && !userExists) {
        const byEmail = await fastify.usersDataSource.readUser(request.body.email)
        if (byEmail) userExists = true;
      }

      if (userExists) {
        throw fastify.httpErrors.conflict('User already registered')
      }

      const { hash, salt } = await generateHash(request.body.password)

      const newUserId = await fastify.usersDataSource.createUser({
        username: request.body.username,
        email: request.body.email,
        salt: salt,
        password: hash,
        role: 'user',
      })

      request.log.info({ userId: newUserId }, 'New user successfully registered');

      reply.code(201)
      return { registered: true }
    }
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
            access_token: { type: 'string' },
            refresh_token: { type: 'string' },
            token_type: { type: 'string' },
            expires_in: { type: 'integer' },
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
      const identifier = request.body.username || request.body.email

      const user = await fastify.usersDataSource.readUser(identifier)

      if (!user) {
        request.log.warn({ identifier }, "Login failed: User not found in DB")
        throw fastify.httpErrors.unauthorized('Invalid credentials')
      }

      const storedHash = user.password || user.hash
      const isMatch = await verifyPassword(request.body.password, user.salt, storedHash)

      if (!isMatch) {
        request.log.warn("Login failed: Password mismatch")
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
        access_token: accessToken,
        refresh_token: refreshToken,
        token_type: 'Bearer',
        expires_in: 3600,
        user: {
          id: user._id,
          username: user.username || user.email,
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