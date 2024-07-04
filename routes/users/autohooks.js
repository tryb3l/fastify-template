'use strict'

const fp = require('fastify-plugin')
const schemas = require('./schemas/loader')

module.exports = fp(
  async function userAutoHooks(fastify) {
    const users = fastify.mongo.db.collection('users')

    fastify.register(schemas)

    fastify.decorate('usersDataSource', {

      async listUsers({ filter = {}, skip = 0, limit = 10 } = {}) {
        return users.find(filter).skip(skip).limit(limit).toArray()
      },
      async countUsers({ filter = {} } = {}) {
        return users.countDocuments(filter)
      },
      async readUserDetails(id) {
        return users.findOne({ _id: fastify.mongo.ObjectId.createFromTime(id) })
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
