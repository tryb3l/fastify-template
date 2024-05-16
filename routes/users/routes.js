'use strict'

const fp = require('fastify-plugin')

module.exports = fp(async function userRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate)
  const users = fastify.mongo.db.collection('users')

  fastify.route({
    method: 'GET',
    url: '/',
    schema: {
      tags: ['users'],
      response: {
        200: {
          type: 'object',
          properties: {
            data: {
              type: 'array',
              items: fastify.getSchema('schema:user'),
            },
          },
        },
        404: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
    handler: async function listUsers(request, reply) {
      const users = await this.usersDataSource.listUsers()
      if (users.length === 0) {
        reply.code(404)
        return { error: 'No users found' }
      }
      return { data: users }
    },
  })

  fastify.route({
    method: 'GET',
    url: '/:id',
    schema: {
      tags: ['users'],
      params: fastify.getSchema('schema:user:read:params'),
      response: {
        200: fastify.getSchema('schema:user'),
      },
    },
    handler: async function readUser(request, reply) {
      const user = await this.usersDataSource.readUser(request.params.id)
      if (!user) {
        reply.code(404)
        return { error: 'User not found' }
      }
      return user
    },
  })

  fastify.route({
    method: 'PUT',
    url: '/:id',
    schema: {
      tags: ['users'],
      params: fastify.getSchema('schema:user:read:params'),
      body: fastify.getSchema('schema:user:update:body'),
    },
    handler: async function updateUser(request, reply) {
      const res = await this.usersDataSource.updateUser(request.params.id, request.body)
      if (res.modifiedCount === 0) {
        reply.code(404)
        return { error: 'User is not found or not updated' }
      }
      reply.code(204)
    },
  })

  fastify.route({
    method: 'DELETE',
    url: '/:id',
    schema: {
      tags: ['users'],
      params: fastify.getSchema('schema:user:read:params'),
    },
    handler: async function deleteUser(request, reply) {
      const res = await users.deleteUser({
        _id: fastify.mongo.ObjectId(request.params.id),
      })
      if (res.deletedCount === 0) {
        reply.code(404)
        return { error: 'User is not found' }
      }
      reply.code(204)
    },
  })
})
