'use strict'

const fp = require('fastify-plugin')
const schemas = require('./schemas/loader')

module.exports = fp(
  async function userAutoHooks(fastify) {
    const users = fastify.mongo.db.collection('users')

    fastify.register(schemas)

    fastify.decorate('usersDataSource', {
      async readUser(username) {
        const user = await users.findOne({ username })
        return user
      },
      async createUser(user) {
        return users
          .insertOne(user)
          .then((result) => result.insertedId)
          .catch((error) => {
            throw error
          })
      },
    })
  },
  {
    encapsulate: true,
    dependencies: ['@fastify/mongodb'],
  },
)
