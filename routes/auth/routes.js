'use strict'

const fp = require('fastify-plugin')

const generateHash = require('./generate-hash')

module.exports.prefixOverride = ''
module.exports = fp(
  async function applicationAuth(fastify) {
    fastify.post('/register', {
      schema: {
        tags: ['auth'],
        summary: 'Register a new user',
        body: fastify.getSchema('schema:auth:register'),
      },
      handler: async function registerHandler(request, reply) {
        const existingUser = await this.usersDataSource.readUser(
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
          const newUserId = await this.usersDataSource.createUser({
            username: request.body.username,
            email: request.body.email,
            salt,
            hash,
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
          200: fastify.getSchema('schema:auth:token'),
        },
      },
      handler: async function authenticateHandler(request, reply) {
        const user = await this.usersDataSource.readUser(request.body.username)
        if (!user) {
          // if we return 404, an attacker can use this to find out which users are registered
          const err = new Error('Wrong credentials provided')
          err.statusCode = 401
          throw err
        }

        const { hash } = await generateHash(request.body.password, user.salt)
        if (hash !== user.hash) {
          const err = new Error('Wrong credentials provided')
          err.statusCode = 401
          throw err
        }

        request.user = user

        return refreshHandler(request, reply)
      },
    })

    fastify.get('/me', {
      onRequest: fastify.authenticate,
      schema: {
        tags: ['auth'],
        summary: 'Get current user details',
        headers: fastify.getSchema('schema:auth:token-header'),
        response: {
          200: {
            type: 'object',
            properties: {
              data: fastify.getSchema('schema:user'),
            },
          },
        },
      },
      handler: async function meHandler(request, reply) {
        try {
          const user = request.user
          if (!user) {
            reply.code(404)
            return { error: 'User not found' }
          }
          return { data: user }
        } catch (error) {
          console.error('Error fetching user details:', error)
          reply.code(500)
          return { error: 'Internal Server Error' }
        }
      },
    })

    fastify.post('/refresh', {
      onRequest: fastify.authenticate,
      schema: {
        tags: ['auth'],
        summary: 'Refresh the token for the current user',
        headers: fastify.getSchema('schema:auth:token-header'),
        response: {
          200: fastify.getSchema('schema:auth:token'),
        },
      },
      handler: refreshHandler,
    })

    async function refreshHandler(request, reply) {
      const accessToken = await request.generateAccessToken()
      const refreshToken = await request.generateRefreshToken()
      if (!accessToken || !refreshToken) {
        const err = new Error('Failed to generate token')
        err.statusCode = 500
        throw err
      }
      reply.setCookie('accessToken', accessToken, { maxAge: fastify.config.cookie.accessMaxAge })
      reply.setCookie('refreshToken', refreshToken, {
        maxAge: fastify.config.cookie.refreshMaxAge,
      })
      reply.send({ accessToken, refreshToken })
    }

    fastify.post('/logout', {
      onRequest: fastify.authenticate,
      schema: {
        tags: ['auth'],
        summary: 'Logout the current user',
        headers: fastify.getSchema('schema:auth:token-header'),
      },
      handler: async function logoutHandler(request, reply) {
        request.revokeToken()
        reply.code(204)
      },
    })
  },
  {
    name: 'auth-routes',
    dependencies: ['authentication-plugin'],
    encapsulate: true,
  },
)
