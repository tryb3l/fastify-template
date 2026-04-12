'use strict'

module.exports = async function userRoutes(fastify, options) {
  const selfUpdateableUserFields = new Set(['username', 'email', 'firstName', 'lastName'])
  const adminUpdateableUserFields = new Set([...selfUpdateableUserFields, 'role'])

  function createRejectUnknownUpdateFields(allowedFields) {
    return async function rejectUnknownUpdateFields(request) {
      if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
        return
      }

      const forbiddenFields = Object.keys(request.body)
        .filter((field) => !allowedFields.has(field))

      if (forbiddenFields.length > 0) {
        throw fastify.httpErrors.badRequest(
          `Body must not contain additional properties: ${forbiddenFields.join(', ')}`,
        )
      }
    }
  }

  const rejectUnknownSelfUpdateFields = createRejectUnknownUpdateFields(selfUpdateableUserFields)
  const rejectUnknownAdminUpdateFields = createRejectUnknownUpdateFields(adminUpdateableUserFields)

  fastify.route({
    method: 'GET',
    url: '/me',
    schema: {
      tags: ['users'],
      summary: 'Read current user profile',
      response: {
        200: {
          type: 'object',
          properties: {
            data: { $ref: 'schema:user#' },
          },
        },
      },
    },
    handler: async function readProfile(request, reply) {
      const user = await fastify.usersDataSource.readUserDetails(request.user._id)
      if (!user) throw fastify.httpErrors.notFound('User not found')
      return { data: user }
    },
  })

  fastify.route({
    method: 'GET',
    url: '/',
    preHandler: fastify.authorize(['admin']),
    schema: {
      tags: ['users'],
      summary: 'List all users (Admin)',
      querystring: { $ref: 'schema:user:list:query#' },
      response: {
        200: { $ref: 'schema:user:list:response#' },
      },
    },
    handler: async function listUsers(request, reply) {
      const { skip, limit, username } = request.query
      const filter = username ? { username } : {}

      const users = await fastify.usersDataSource.listUsers({ filter, skip, limit })
      const totalCount = await fastify.usersDataSource.countUsers({ filter })

      return { data: users, totalCount }
    },
  })

  fastify.route({
    method: 'GET',
    url: '/:id',
    preHandler: fastify.authorize(['admin']),
    schema: {
      tags: ['users'],
      summary: 'Read user by id (Admin)',
      params: { $ref: 'schema:user:read:params#' },
      response: {
        200: {
          type: 'object',
          properties: {
            data: { $ref: 'schema:user#' },
          },
        },
      },
    },
    handler: async function readUser(request, reply) {
      const user = await fastify.usersDataSource.readUserDetails(request.params.id)
      if (!user) throw fastify.httpErrors.notFound('User not found')
      return { data: user }
    },
  })

  fastify.route({
    method: 'PUT',
    url: '/me',
    preValidation: rejectUnknownSelfUpdateFields,
    schema: {
      tags: ['users'],
      summary: 'Update own profile',
      body: { $ref: 'schema:user:update:body#' },
      response: {
        200: {
          type: 'object',
          properties: { data: { $ref: 'schema:user#' } },
        },
      },
    },
    handler: async function updateSelf(request, reply) {
      const id = request.user._id
      const res = await fastify.usersDataSource.updateUser(id, request.body)
      if (res.modifiedCount === 0) {
        throw fastify.httpErrors.notFound('User not found or no changes made')
      }
      const updated = await fastify.usersDataSource.readUserDetails(id)
      return { data: updated }
    },
  })

  fastify.route({
    method: 'DELETE',
    url: '/me',
    schema: {
      tags: ['users'],
      summary: 'Soft delete own account',
    },
    handler: async function deleteSelf(request, reply) {
      const id = request.user._id
      const ok = await fastify.usersDataSource.deleteUser(id)
      if (!ok) throw fastify.httpErrors.notFound('User not found or already deleted')

      if (fastify.auditLog) {
        fastify.auditLog({
          request,
          action: 'user_soft_deleted',
          userId: id,
          resourceType: 'user',
          resourceId: id,
        })
      }

      reply.code(204).send()
    },
  })

  fastify.route({
    method: 'PUT',
    url: '/:id',
    preHandler: fastify.authorize(['admin']),
    preValidation: rejectUnknownAdminUpdateFields,
    schema: {
      tags: ['users'],
      summary: 'Update user by id (Admin)',
      params: { $ref: 'schema:user:read:params#' },
      body: { $ref: 'schema:user:update:admin:body#' },
      response: {
        204: { type: 'null' },
      },
    },
    handler: async function updateUser(request, reply) {
      const roleUpdateRequested = request.body && request.body.role !== undefined
      const existingUser = roleUpdateRequested
        ? await fastify.usersDataSource.readUserDetails(request.params.id)
        : null

      const res = await fastify.usersDataSource.updateUser(request.params.id, request.body)
      if (res.modifiedCount === 0) {
        throw fastify.httpErrors.notFound('User not found or no changes made')
      }

      if (
        fastify.auditLog &&
        roleUpdateRequested &&
        existingUser &&
        existingUser.role !== request.body.role
      ) {
        fastify.auditLog({
          request,
          action: 'user_role_changed',
          userId: request.user._id || request.user.id,
          resourceType: 'user',
          resourceId: request.params.id,
          details: {
            previousRole: existingUser.role,
            newRole: request.body.role,
            targetUserId: request.params.id,
          },
        })
      }

      reply.code(204).send()
    },
  })

  fastify.route({
    method: 'DELETE',
    url: '/:id',
    preHandler: fastify.authorize(['admin']),
    schema: {
      tags: ['users'],
      summary: 'Soft delete user by id (Admin)',
      params: { $ref: 'schema:user:read:params#' },
    },
    handler: async function deleteUser(request, reply) {
      const res = await fastify.usersDataSource.deleteUser(request.params.id)
      if (!res) {
        throw fastify.httpErrors.notFound('User not found or already deleted')
      }

      if (fastify.auditLog) {
        fastify.auditLog({
          request,
          action: 'user_soft_deleted',
          userId: request.user._id || request.user.id,
          resourceType: 'user',
          resourceId: request.params.id,
        })
      }

      reply.code(204).send()
    },
  })
}

module.exports.autoPrefix = '/users'
