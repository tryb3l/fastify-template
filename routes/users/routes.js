'use strict'

module.exports = async function userRoutes(fastify, options) {
  
  fastify.addHook('onRequest', fastify.authenticate)

  fastify.route({
    method: 'GET',
    url: '/me',
    schema: {
      tags: ['users'],
      summary: 'Read current user profile',
      headers: fastify.getSchema('schema:auth:token-header'),
      response: {
        200: {
          type: 'object',
          properties: {
            data: fastify.getSchema('schema:user'),
          },
        },
        404: {
          type: 'object',
          properties: {
            error: { type: 'string' }
          }
        }
      },
    },
    handler: async function readProfile(request, reply) {
      const user = await fastify.usersDataSource.readUserDetails(request.user.id)
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
      headers: fastify.getSchema('schema:auth:token-header'),
      querystring: fastify.getSchema('schema:user:list:query'),

      response: {
        200: fastify.getSchema('schema:user:list:response'),
        400: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            message: { type: 'string' },
            statusCode: { type: 'integer' },
          },
          required: ['error', 'message', 'statusCode'],
        },
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
      headers: fastify.getSchema('schema:auth:token-header'),
      params: fastify.getSchema('schema:user:read:params'),
      response: {
        200: {
          type: 'object',
          properties: {
            data: fastify.getSchema('schema:user'),
          },
        },
        404: {
          type: 'object',
          properties: {
            error: { type: 'string' }
          }
        }
      },
    },
    handler: async function readUser(request, reply) {
      try {
        const user = await fastify.usersDataSource.readUserDetails(request.params.id)
        if (!user) throw fastify.httpErrors.notFound('User not found')
        return { data: user }
      } catch (error) {
        if (error.statusCode === 404) throw error;
        throw fastify.httpErrors.internalServerError('Internal Server Error');
      }
    },
  })

  fastify.route({
    method: 'PUT',
    url: '/:id',
    preHandler: fastify.authorize(['admin']),
    schema: {
      tags: ['users'],
      summary: 'Update user by id (Admin)',
      headers: fastify.getSchema('schema:auth:token-header'),
      params: fastify.getSchema('schema:user:read:params'),
      body: fastify.getSchema('schema:user:update:body'),
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
      headers: fastify.getSchema('schema:auth:token-header'),
      params: fastify.getSchema('schema:user:read:params'),
    },
    handler: async function deleteUser(request, reply) {
      const res = await fastify.usersDataSource.deleteUser(request.params.id)
      if (!res) {
        throw fastify.httpErrors.notFound('User not found or already deleted')
      }
      reply.code(204).send()
    },
  })
}

module.exports.autoPrefix = '/users'