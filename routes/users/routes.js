'use strict'

const fp = require('fastify-plugin')

module.exports = fp(async function userRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate)
  //const users = fastify.mongo.db.collection('users')

  fastify.route({
    method: 'GET',
    url: '/users',
    schema: {
      tags: ['users'],
      headers: fastify.getSchema('schema:auth:token-header'),
      querystring: {
        type: 'object',
        properties: {
          skip: { type: 'integer', default: 0 },
          limit: { type: 'integer', default: 10 },
          username: { type: 'string' },
        },
        required: [],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            data: { type: 'array', items: fastify.getSchema('schema:user') },
            totalCount: { type: 'integer' },
          },
        },
        404: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
    handler: async function listUsers(request, reply) {
      const { skip, limit, username } = request.query
      const filter = username ? { username } : {}
      const users = await this.usersDataSource.listUsers({ filter, skip, limit })
      const totalCount = await this.usersDataSource.countUsers({ filter })

      reply.code(200)
      return { data: users, totalCount }
    },
  })

  fastify.route({
    method: 'GET',
    url: '/user-details/:id',
    schema: {
      tags: ['users'],
      headers: fastify.getSchema('schema:auth:token-header'),
      params: fastify.getSchema('schema:user:read:params', 'schema:auth:token-header'),
      response: {
        200: {
          type: 'object',
          properties: {
            data: fastify.getSchema('schema:user'),
          },
        },
      },
    },
    handler: async function readUserDetails(request, reply) {
      try {
        const user = await this.usersDataSource.readUserDetails(request.params.id)
        if (!user) {
          reply.code(404)
          return { error: 'User not found' }
        }
        console.log('Raw user object', user)

        return { data: user }
      } catch (error) {
        console.error('Error fetching user details:', error)
        reply.code(500)
        return { error: 'Internal Server Error' }
      }
    },
  }),
    fastify.route({
      method: 'GET',
      url: '/user/:id',
      schema: {
        tags: ['users'],
        headers: fastify.getSchema('schema:auth:token-header'),
        params: fastify.getSchema('schema:user:read:params', 'schema:auth:token-header'),
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
    url: '/user/:id',
    schema: {
      tags: ['users'],
      headers: fastify.getSchema('schema:auth:token-header'),
      params: fastify.getSchema('schema:user:read:params', 'schema:auth:token-header'),
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
    url: '/user/:id',
    schema: {
      tags: ['users'],
      headers: fastify.getSchema('schema:auth:token-header'),
      params: fastify.getSchema('schema:user:read:params'),
    },
    handler: async function deleteUser(request, reply) {
      const res = await this.usersDataSource.deleteUser(request.params.id)
      if (res.deletedCount === 0) {
        reply.code(404)
        return { error: 'User is not found' }
      }
      reply.code(204)
    },
  })
})
