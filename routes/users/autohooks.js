'use strict'

const fp = require('fastify-plugin')
const schemas = require('./schemas/loader')

module.exports = fp(
  async function userAutoHooks(fastify) {
    const users = fastify.mongo.db.collection('users')

    fastify.register(schemas)

    fastify.decorate('usersDataSource', {
      async listUsers({
        filter = {},
        projection = {},
        skip = 0,
        limit = 50,
        asStream = false,
      } = {}) {
        const cursor = await users.find(filter, {
          projection: { ...projection, _id: 0 },
          limit,
          skip,
        })
        if (asStream) {
          return cursor.stream()
        }
        return cursor.toArray()
      },

      async readUser(id, projection = {}) {
        if (!fastify.mongo.ObjectId.isValid(id)) {
          return null
        } else if (!id) {
          throw new Error('Missing user id')
        }

        const user = await users.findOne(
          { _id: fastify.mongo.ObjectId.createFromTime(id) },
          { projection: { ...projection, _id: 1, email: 1, firstname: 1, lastname: 1 } },
        )

        if (!user) {
          throw new Error('User not found')
        }

        return user
      },

      async updateUser(id, newUser) {
        return users.updateOne(
          { _id: fastify.mongo.ObjectId.createFromTime(id) },
          {
            $set: {
              ...newUser,
              modifiedAt: new Date(),
            },
          },
        )
      },

      async deleteUser(id) {
        return users.deleteOne({
          _id: fastify.mongo.ObjectId.createFromTime(id),
        })
      },
    })
  },
  { encapsulate: true, dependencies: ['@fastify/mongodb'], name: 'users-store' },
)
