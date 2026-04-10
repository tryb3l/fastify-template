'use strict'

const { validatePassword, hashPassword } = require('../auth/generate-hash')

module.exports = async function authRoutes(fastify) {
  fastify.post('/register', {
    schema: {
      tags: ['auth'],
      summary: 'Register a new user',
      body: { $ref: 'schema:auth:register#' },
      response: {
        201: {
          type: 'object',
          properties: { registered: { type: 'boolean' } },
        },
      },
    },
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    handler: async function registerHandler(request, reply) {
      let userExists = false

      if (request.body.username) {
        const byUsername = await fastify.usersDataSource.readUser(request.body.username)
        if (byUsername) userExists = true
      }

      if (request.body.email && !userExists) {
        const byEmail = await fastify.usersDataSource.readUser(request.body.email)
        if (byEmail) userExists = true
      }

      if (userExists) {
        throw fastify.httpErrors.conflict('User already registered')
      }

      const hash = await hashPassword(request.body.password)

      const newUserId = await fastify.usersDataSource.createUser({
        username: request.body.username,
        email: request.body.email,
        hash: hash,
        role: 'user',
      })

      request.log.info({ userId: newUserId }, 'New user successfully registered')

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
            access_token: { type: 'string' },
            token_type: { type: 'string' },
            expires_in: { type: 'integer' },
            user: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                username: { type: 'string' },
                role: { type: 'string' },
              },
            },
          },
        },
      },
    },
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    handler: async function authenticateHandler(request, reply) {
      const identifier = request.body.username || request.body.email

      const user = await fastify.usersDataSource.readUserWithHash(identifier)

      if (!user) {
        request.log.warn({ identifier }, 'Login failed: User not found in DB')
        if (fastify.auditLog) {
          await fastify.auditLog({
            request,
            action: 'auth_login_failed',
            resourceType: 'user',
            resourceId: identifier,
            details: { reason: 'user_not_found' },
          })
        }
        throw fastify.httpErrors.unauthorized('Invalid credentials')
      }

      if (user.deleted === true) {
        if (fastify.auditLog) {
          await fastify.auditLog({
            request,
            action: 'auth_login_failed',
            userId: user._id,
            resourceType: 'user',
            resourceId: user._id,
            details: { reason: 'account_deleted' },
          })
        }
        throw fastify.httpErrors.unauthorized('Invalid credentials')
      }

      const storedHash = user.password || user.hash
      let isMatch
      try {
        isMatch = await validatePassword(request.body.password, storedHash)
      } catch (err) {
        request.log.error({ err }, 'Password verification failed due to operational error')
        throw fastify.httpErrors.internalServerError('Authentication service error')
      }

      if (!isMatch) {
        request.log.warn('Login failed: Password mismatch')
        if (fastify.auditLog) {
          await fastify.auditLog({
            request,
            action: 'auth_login_failed',
            userId: user._id,
            resourceType: 'user',
            resourceId: user._id,
            details: { reason: 'invalid_password' },
          })
        }
        throw fastify.httpErrors.unauthorized('Invalid credentials')
      }

      const { accessToken, refreshToken } = await request.generateTokens(user)

      if (fastify.auditLog) {
        await fastify.auditLog({
          request,
          action: 'auth_login_success',
          userId: user._id,
          resourceType: 'user',
          resourceId: user._id,
        })
      }

      const cookieOptions = {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        signed: false,
      }

      reply.setCookie('refreshToken', refreshToken, {
        ...cookieOptions,
        path: '/auth',
        maxAge: fastify.config.cookie.refreshMaxAge,
      })

      const decodedAccess = fastify.jwt.decode(accessToken)
      const expiresIn = decodedAccess.exp - Math.floor(Date.now() / 1000)

      return {
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: expiresIn,
        user: {
          id: user._id,
          username: user.username || user.email,
          role: user.role,
        },
      }
    },
  })

  fastify.post('/refresh', {
    onRequest: fastify.verifyRefreshToken,
    preValidation: fastify.csrfProtection,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      tags: ['auth'],
      summary: 'Refresh access token',
      description: 'Uses the httpOnly refresh cookie to generate a new access token.',
      response: {
        200: {
          type: 'object',
          properties: {
            access_token: { type: 'string' },
            token_type: { type: 'string' },
            expires_in: { type: 'integer' },
            user: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                username: { type: 'string' },
                role: { type: 'string' },
              },
            },
          },
        },
      },
    },
    handler: async function refreshHandler(request, reply) {
      await request.revokeToken(request.refreshTokenId, request.refreshTokenExp, request.user._id)
      const { accessToken, refreshToken } = await request.generateTokens(request.user)

      const cookieOptions = {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        signed: false,
      }

      reply.setCookie('refreshToken', refreshToken, {
        ...cookieOptions,
        path: '/auth',
        maxAge: fastify.config.cookie.refreshMaxAge,
      })

      const decodedAccess = fastify.jwt.decode(accessToken)
      const expiresIn = decodedAccess.exp - Math.floor(Date.now() / 1000)

      return {
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: expiresIn,
        user: {
          id: request.user._id,
          username: request.user.username || request.user.email,
          role: request.user.role,
        },
      }
    },
  })

  fastify.post('/logout', {
    onRequest: fastify.verifyRefreshToken,
    preValidation: fastify.csrfProtection,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      tags: ['auth'],
      summary: 'Logout the current user',
    },
    handler: async function logoutHandler(request, reply) {
      await request.revokeToken(request.refreshTokenId, request.refreshTokenExp, request.user._id)

      reply.clearCookie('refreshToken', { path: '/auth' })

      reply.code(204).send()
    },
  })

  fastify.get('/csrf', {
    schema: {
      tags: ['auth'],
      summary: 'Get CSRF token',
    },
    handler: async function csrfHandler(request, reply) {
      return { csrfToken: await reply.generateCsrf() }
    },
  })

  fastify.post('/reset-password/request', {
    config: { rateLimit: { max: 3, timeWindow: '1 hour' } },
    schema: {
      tags: ['auth'],
      summary: 'Request a password reset',
      body: { $ref: 'schema:auth:reset-request#' },
      response: {
        200: {
          type: 'object',
          properties: { message: { type: 'string' } },
        },
      },
    },
    handler: async function resetRequestHandler(request, reply) {
      await fastify.passwordResetService.requestReset({
        request,
        email: request.body.email,
      })
      return {
        message: 'If an account exists for that email, a password reset link has been sent.',
      }
    },
  })

  fastify.post('/reset-password/validate', {
    config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
    schema: {
      tags: ['auth'],
      summary: 'Validate a password reset token before showing the reset form',
      body: { $ref: 'schema:auth:reset-validate#' },
      response: {
        200: {
          type: 'object',
          properties: { valid: { type: 'boolean' } },
        },
      },
    },
    handler: async function resetValidateHandler(request, reply) {
      const isValid = await fastify.passwordResetService.validateToken({
        request,
        resetId: request.body.resetId,
        rawSecret: request.body.secret,
      })
      if (!isValid) {
        throw fastify.httpErrors.unauthorized('Invalid or expired reset token')
      }
      return { valid: true }
    },
  })

  fastify.post('/reset-password/confirm', {
    config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
    schema: {
      tags: ['auth'],
      summary: 'Execute the password reset and invalidate current sessions',
      body: { $ref: 'schema:auth:reset-confirm#' },
      response: {
        200: {
          type: 'object',
          properties: { message: { type: 'string' } },
        },
      },
    },
    handler: async function resetConfirmHandler(request, reply) {
      const success = await fastify.passwordResetService.executeReset({
        request,
        resetId: request.body.resetId,
        rawSecret: request.body.secret,
        newPassword: request.body.newPassword,
      })

      if (!success) {
        throw fastify.httpErrors.unauthorized('Invalid or expired reset token')
      }
      return { message: 'Password has been successfully reset. You may now log in.' }
    },
  })
}
