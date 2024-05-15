'use strict'

const fp = require('fastify-plugin')

module.exports = fp(async function userRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate)
  const users = fastify.mongo.db.collection('users')

  //update user
  fastify.route({
    method: 'PUT',
    url: '/:id',
    schema: {
      tags: ['users'],
      params: fastify.getSchema('schema:user:read:params'),
      body: fastify.getSchema('schema:user:update:body'),
      handler: async function updateUser(request, reply) {
        const res = await this.usersDataSource.updateUser(request.params.id.request.body)
        if (!res) {
          reply.code(404)
          return { error: 'User is not found' }
        }
        reply.code(200)
      },
    },
  })

  //delete user
  fastify.route({
    method: 'DELETE',
    url: '/:id',
    schema: {
      tags: ['users'],
      params: fastify.getSchema('schema:user:read:params'),
    },
    handler: async function deleteUser(request, reply) {
      const res = await users.deleteUser({
        _id: new fastify.mongo.ObjectId(request.params.id),
      })
      if (res.delededCount === 0) {
        reply.code(404)
        return { error: 'User is not found' }
      }
      reply.code(204)
    },
  })
})
