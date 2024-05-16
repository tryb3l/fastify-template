'use strict'

const fp = require('fastify-plugin')
const schemas = require('./schemas/loader')

module.exports = fp(
  async function userAutoHooks(fastify) {
    const users = fastify.mongo.db.collection('users')

    fastify.register(schemas)

    fastify.decorate('usersDataSource', {
      async listUsers() {
        const userList = await users.find().toArray()
        return userList
      },

      async readUser(username) {
        const user = await users.findOne({ username })
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
