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
        if (filter.title) {
          filter.title = new RegExp(filter.title, 'i')
        } else {
          delete filter.title
        }
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
        const user = await users.findOne(
          { _id: fastify.mongo.ObjectId.createFromTime(id) },
          { projection: { ...projection, _id: 0 } },
        )
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
