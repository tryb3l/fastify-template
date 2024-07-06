'use strict'

const fp = require('fastify-plugin')
const schemas = require('./schemas/loader')

module.exports = fp(
  async function userAutoHooks(fastify) {
    const users = fastify.mongo.db.collection('users')

    fastify.register(schemas)

    fastify.decorate('usersDataSource', {
      async listUsers({ filter = {}, skip = 0, limit = 10 } = {}) {
        return await users
          .find(filter, {
            projection: {
              _id: 1,
              username: 1,
              email: 1,
              firstName: 1,
              lastName: 1,
              createdAt: 1,
              modifiedAt: 1,
            },
          })
          .skip(skip)
          .limit(limit)
          .toArray()
      },
      async countUsers({ filter = {} } = {}) {
        return await users.countDocuments(filter)
      },
      async readUserDetails(id) {
        return await users.findOne(
          { _id: id },
          {
            projection: {
              _id: 1,
              username: 1,
              email: 1,
              firstName: 1,
              lastName: 1,
              createdAt: 1,
              modifiedAt: 1,
            },
          },
        )
      },

      async updateUser(id, newUser) {
        return await users.updateOne(
          { _id: id },
          {
            $set: {
              ...newUser,
              modifiedAt: new Date(),
            },
          },
        )
      },

      async deleteUser(id) {
        return await users.deleteOne({
          _id: id,
        })
      },
    })
  },
  { encapsulate: true, dependencies: ['@fastify/mongodb'], name: 'users-store' },
)
