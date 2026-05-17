'use strict'

const fp = require('fastify-plugin')
const { randomUUIDv7 } = require('node:crypto')
const { instantToDate, nowInstant } = require('../utils/time')

async function usersPlugin(fastify) {
  const users = fastify.mongo.db.collection('users')
  const revokedTokens = fastify.mongo.db.collection('revokedTokens')
  const getFindOneAndUpdateValue = (result) => {
    return result && typeof result === 'object' && 'value' in result ? result.value : result
  }

  const usersDataSource = {
    async createUser(userData) {
      fastify.log.info('Entering createUser method')
      userData._id = randomUUIDv7()
      userData.createdAt = instantToDate(nowInstant())
      userData.modifiedAt = instantToDate(nowInstant())
      userData.role = userData.role || 'user'
      userData.credentialsVersion = 0
      try {
        const result = await users.insertOne(userData)
        fastify.log.info('Exiting createUser method')
        return result.insertedId
      } catch (error) {
        if (error.code === 11000) {
          throw fastify.httpErrors.conflict('User already registered')
        }
        fastify.log.error({ error }, 'Error creating user')
        throw error
      }
    },
    async readUser(identifier) {
      fastify.log.info('Entering readUser method')
      try {
        const user = await users.findOne(
          { $or: [{ username: identifier }, { email: identifier }], deleted: { $ne: true } },
          {
            projection: {
              _id: 1,
              username: 1,
              email: 1,
              role: 1,
              deleted: 1,
              createdAt: 1,
              modifiedAt: 1,
              credentialsVersion: 1,
            },
          },
        )
        fastify.log.info('Exiting readUser method')
        return user
      } catch (error) {
        fastify.log.error({ error }, 'Error reading user')
        throw error
      }
    },
    async readUserForPasswordReset(email) {
      fastify.log.info('Entering readUserForPasswordReset method')
      try {
        const user = await users.findOne(
          { email, deleted: { $ne: true } },
          {
            projection: {
              _id: 1,
              email: 1,
              'passwordReset.id': 1,
              'passwordReset.requestedAt': 1,
              'passwordReset.expiresAt': 1,
              'passwordReset.failedAttempts': 1,
            },
          },
        )
        fastify.log.info('Exiting readUserForPasswordReset method')
        return user
      } catch (error) {
        fastify.log.error({ error }, 'Error reading user for password reset')
        throw error
      }
    },
    async readUserWithHash(identifier) {
      fastify.log.info('Entering readUserWithHash method')
      try {
        const user = await users.findOne(
          { $or: [{ username: identifier }, { email: identifier }], deleted: { $ne: true } },
          {
            projection: {
              _id: 1,
              username: 1,
              email: 1,
              role: 1,
              hash: 1,
              deleted: 1,
              createdAt: 1,
              modifiedAt: 1,
              credentialsVersion: 1,
            },
          },
        )
        fastify.log.info('Exiting readUserWithHash method')
        return user
      } catch (error) {
        fastify.log.error({ error }, 'Error reading user with hash')
        throw error
      }
    },
    async listUsers({ filter = {}, skip = 0, limit = 10 } = {}) {
      fastify.log.info('Entering listUsers method')
      try {
        const queryFilter = { ...filter, deleted: { $ne: true } }
        const usersList = await users
          .find(queryFilter, {
            projection: {
              _id: 1,
              username: 1,
              email: 1,
              firstName: 1,
              lastName: 1,
              role: 1,
              createdAt: 1,
              modifiedAt: 1,
            },
          })
          .skip(skip)
          .limit(limit)
          .toArray()
        fastify.log.info('Exiting listUsers method')
        return usersList
      } catch (error) {
        fastify.log.error({ error }, 'Error listing users')
        throw error
      }
    },
    async countUsers({ filter = {} } = {}) {
      fastify.log.info('Entering countUsers method')
      try {
        const queryFilter = { ...filter, deleted: { $ne: true } }
        const count = await users.countDocuments(queryFilter)
        fastify.log.info('Exiting countUsers method')
        return count
      } catch (error) {
        fastify.log.error({ error }, 'Error counting users')
        throw error
      }
    },
    async readUserDetails(id) {
      fastify.log.info('Entering readUserDetails method')
      try {
        const user = await users.findOne(
          { _id: id, deleted: { $ne: true } },
          {
            projection: {
              _id: 1,
              username: 1,
              email: 1,
              firstName: 1,
              lastName: 1,
              role: 1,
              createdAt: 1,
              modifiedAt: 1,
            },
          },
        )
        fastify.log.info('Exiting readUserDetails method')
        return user
      } catch (error) {
        fastify.log.error({ error }, 'Error reading user details')
        throw error
      }
    },
    async readUserById(id) {
      fastify.log.info('Entering readUserById method')
      try {
        const user = await users.findOne(
          { _id: id, deleted: { $ne: true } },
          {
            projection: {
              _id: 1,
              username: 1,
              email: 1,
              role: 1,
              credentialsVersion: 1,
            },
          },
        )
        fastify.log.info('Exiting readUserById method')
        return user
      } catch (error) {
        fastify.log.error(
          { error, id },
          'Failed to read user by ID due to Database availability anomaly',
        )
        throw error
      }
    },
    async updateUser(id, newUser) {
      fastify.log.info('Entering updateUser method')
      try {
        const result = await users.updateOne(
          { _id: id, deleted: { $ne: true } },
          {
            $set: {
              ...newUser,
              modifiedAt: instantToDate(nowInstant()),
            },
          },
        )
        fastify.log.info('Exiting updateUser method')
        return result
      } catch (error) {
        fastify.log.error({ error, id }, 'Error updating user')
        throw error
      }
    },
    async deleteUser(id) {
      fastify.log.info('Entering deleteUser method')
      try {
        const res = await users.updateOne(
          { _id: id, deleted: { $ne: true } },
          { $set: { deleted: true, deletedAt: instantToDate(nowInstant()) } },
        )

        if (res.modifiedCount === 0) {
          fastify.log.info(
            { userId: id },
            "User for delete does not exist or user can't be deleted",
          )
          return false
        }

        await this.deleteRevokedTokens(id)

        fastify.log.info('Exiting deleteUser method')
        return true
      } catch (error) {
        fastify.log.error({ error, id }, 'Error deleting user')
        throw error
      }
    },
    async getSoftDeletedUserById(userId) {
      fastify.log.info('Entering getSoftDeletedUserById method')
      try {
        const deletedUser = await users.findOne({ _id: userId, deleted: true }, {})
        fastify.log.info('Exiting getSoftDeletedUserById method')
        return deletedUser
      } catch (error) {
        fastify.log.error({ error, userId }, 'Error getting soft deleted user')
        throw error
      }
    },
    async setUserRoleById(userId, role) {
      fastify.log.info('Entering setUserRoleById method')
      try {
        await users.updateOne({ _id: userId, deleted: { $ne: true } }, { $set: { role } })
        fastify.log.info({ role, userId }, 'User set new role')
        fastify.log.info('Exiting setUserRoleById method')
        return true
      } catch (error) {
        fastify.log.error({ error, userId }, 'Error setting user role')
        throw error
      }
    },
    async getUsersWithRole(role) {
      fastify.log.info('Entering getUsersWithRole method')
      try {
        const usersList = await users.find({ role: role, deleted: { $ne: true } }, {}).toArray()
        fastify.log.info('Exiting getUsersWithRole method')
        return usersList
      } catch (error) {
        fastify.log.error({ error, role }, 'Error getting users with role')
        throw error
      }
    },
    async checkIfRevoked(jti) {
      fastify.log.info('Entering checkIfRevoked method')
      try {
        const token = await revokedTokens.findOne({ _id: jti }, { projection: { _id: 1 } })
        fastify.log.info('Exiting checkIfRevoked method')
        return token !== null
      } catch (error) {
        fastify.log.error({ error, jti }, 'Database check revoke failure')
        throw error
      }
    },
    async revokeToken(jti, exp, userId) {
      fastify.log.info('Entering revokeToken method')
      try {
        const expirationDate = new Date(exp * 1000)

        await revokedTokens.insertOne({
          _id: jti,
          userId: userId,
          expiresAt: expirationDate,
        })

        fastify.log.info({ jti }, 'Token added to TTL blocklist')
      } catch (error) {
        if (error.code === 11000) {
          fastify.log.info({ jti }, 'Token was already revoked')
          return
        }
        fastify.log.error({ error, jti }, 'Database failure on token revoke')
        throw error
      }
    },
    async deleteRevokedTokens(userId) {
      fastify.log.info('Entering deleteRevokedTokens method')
      try {
        const deleteResult = await revokedTokens.deleteMany({ userId })
        fastify.log.info(
          { userId, result: deleteResult },
          'Tokens removed (many on specific user id) on DB/Store',
        )
        fastify.log.info('Exiting deleteRevokedTokens method')
      } catch (error) {
        fastify.log.error({ error, userId }, 'Error on bulk token revoke status')
        throw error
      }
    },
    async initiatePasswordReset(userId, resetId, secretHash, requestedAt, expiresAt) {
      fastify.log.info({ userId, resetId }, 'Entering initiatePasswordReset method')
      const result = await users.updateOne(
        { _id: userId, deleted: { $ne: true } },
        {
          $set: {
            passwordReset: {
              id: resetId,
              secretHash,
              requestedAt,
              expiresAt,
              failedAttempts: 0,
            },
          },
        },
      )
      fastify.log.info('Exiting initiatePasswordReset method')
      return result.modifiedCount === 1
    },

    async verifyAndExecutePasswordReset(resetId, secretHash, newHash, maxAttempts) {
      fastify.log.info({ resetId }, 'Entering verifyAndExecutePasswordReset method')

      const now = instantToDate(nowInstant())
      const result = await users.findOneAndUpdate(
        {
          'passwordReset.id': resetId,
          'passwordReset.secretHash': secretHash,
          'passwordReset.expiresAt': { $gt: now },
          $or: [
            { 'passwordReset.failedAttempts': { $exists: false } },
            { 'passwordReset.failedAttempts': { $lt: maxAttempts } },
          ],
          deleted: { $ne: true },
        },
        {
          $set: {
            hash: newHash,
            modifiedAt: now,
            passwordChangedAt: now,
          },
          $inc: { credentialsVersion: 1 },
          $unset: { passwordReset: '' },
        },
        {
          projection: { _id: 1, email: 1 },
          returnDocument: 'before',
        },
      )

      const user = getFindOneAndUpdateValue(result)

      fastify.log.info('Exiting verifyAndExecutePasswordReset method')
      return user
    },

    async incrementPasswordResetFailedAttempts(resetId, maxAttempts) {
      fastify.log.info({ resetId }, 'Entering incrementPasswordResetFailedAttempts method')

      const now = instantToDate(nowInstant())
      const result = await users.findOneAndUpdate(
        {
          'passwordReset.id': resetId,
          $or: [
            { 'passwordReset.failedAttempts': { $exists: false } },
            { 'passwordReset.failedAttempts': { $lt: maxAttempts } },
          ],
          deleted: { $ne: true },
        },
        {
          $inc: { 'passwordReset.failedAttempts': 1 },
          $set: { modifiedAt: now },
        },
        {
          projection: {
            _id: 1,
            email: 1,
            'passwordReset.id': 1,
            'passwordReset.expiresAt': 1,
            'passwordReset.failedAttempts': 1,
          },
          returnDocument: 'after',
        },
      )

      const user = getFindOneAndUpdateValue(result)

      fastify.log.info('Exiting incrementPasswordResetFailedAttempts method')
      return user
    },

    async rescindPasswordReset(resetId) {
      await users.updateOne(
        { 'passwordReset.id': resetId },
        {
          $set: { modifiedAt: instantToDate(nowInstant()) },
          $unset: { passwordReset: '' },
        },
      )
    },

    async checkPasswordResetExists(resetId) {
      return await users.findOne(
        {
          'passwordReset.id': resetId,
          deleted: { $ne: true },
        },
        {
          projection: {
            _id: 1,
            email: 1,
            'passwordReset.id': 1,
            'passwordReset.secretHash': 1,
            'passwordReset.expiresAt': 1,
            'passwordReset.failedAttempts': 1,
          },
        },
      )
    },
  }

  fastify.decorate('usersDataSource', usersDataSource)
  fastify.log.info('Successfully registered users plugin')
}

module.exports = fp(usersPlugin, {
  name: 'users-store',
  dependencies: ['db-plugin'],
  decorators: {
    fastify: ['mongo'],
  },
})
