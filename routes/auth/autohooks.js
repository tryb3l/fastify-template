'use strict'

const fp = require('fastify-plugin')
const schemas = require('./schemas/loader')
const { randomUUID } = require('node:crypto')

module.exports = fp(
  async function userAutoHooks(fastify) {
    const users = fastify.mongo.db.collection('users')

    fastify.register(schemas)

    fastify.decorate('usersDataSource', {
      async readUser(username, email) {
        const user = await users.findOne({ $or: [{ username }, { email }] });
        return user;
      },
      async createUser(user) {
        user._id = randomUUID()
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
