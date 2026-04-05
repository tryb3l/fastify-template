'use strict'

module.exports = async function userRoutes(fastify, options) {
  fastify.addHook('onRequest', fastify.authenticate)

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
      const user = await fastify.usersDataSource.readUserDetails(request.user._id);
      if (!user) throw fastify.httpErrors.notFound('User not found');
      return { data: user };
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
    }
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
    url: '/:id',
    preHandler: fastify.authorize(['admin']),
    schema: {
      tags: ['users'],
      summary: 'Update user by id (Admin)',
      params: { $ref: 'schema:user:read:params#' },
      body: { $ref: 'schema:user:update:body#' },
    },
    handler: async function updateUser(request, reply) {
      const res = await fastify.usersDataSource.updateUser(request.params.id, request.body)
      if (res.modifiedCount === 0) {
        throw fastify.httpErrors.notFound('User not found or no changes made')
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
        await fastify.auditLog({
          request,
          action: 'user_soft_deleted',
          userId: request.user._id || request.user.id,
          resourceType: 'user',
          resourceId: request.params.id
        })
      }

      reply.code(204).send()
    },
  })
}

module.exports.autoPrefix = '/users'