'use strict';

const fp = require('fastify-plugin');
const { randomUUID } = require('node:crypto');
const { authSchemasLoader } = require('../routes/auth/schemas/loader')
const { userSchemasLoader } = require('../routes/users/schemas/loader')

async function usersPlugin(fastify) {

  const users = fastify.mongo.db.collection('users');
  const revokedTokens = fastify.mongo.db.collection('revokedTokens');


  const usersDataSource = {
    async createUser(userData) {
      fastify.log.info('Entering createUser method');
      userData._id = randomUUID();
      userData.createdAt = new Date();
      userData.modifiedAt = new Date();
      userData.role = userData.role || 'user';
      try {
        const result = await users.insertOne(userData);
        fastify.log.info('Exiting createUser method');
        return result.insertedId;
      } catch (error) {
        fastify.log.error({ error }, 'Error creating user');
        throw error;
      }
    },
    async readUser(username, email) {
      fastify.log.info('Entering readUser method');
      try {
        const user = await users.findOne(
          { $or: [{ username }, { email }] },
          {
            projection: {
              _id: 1,
              username: 1,
              email: 1,
              role: 1,
              salt: 1,
              hash: 1,
              createdAt: 1,
              modifiedAt: 1,
            },
          },
        );
        fastify.log.info('Exiting readUser method');
        return user;
      } catch (error) {
        fastify.log.error({ error }, 'Error reading user');
        throw error;
      }
    },
    async listUsers({ filter = {}, skip = 0, limit = 10 } = {}) {
      fastify.log.info('Entering listUsers method');
      try {
        const usersList = await users
          .find(filter, {
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
          .toArray();
        fastify.log.info('Exiting listUsers method');
        return usersList;
      } catch (error) {
        fastify.log.error({ error }, 'Error listing users');
        throw error;
      }
    },
    async countUsers({ filter = {} } = {}) {
      fastify.log.info('Entering countUsers method');
      try {
        const count = await users.countDocuments(filter);
        fastify.log.info('Exiting countUsers method');
        return count;
      } catch (error) {
        fastify.log.error({ error }, 'Error counting users');
        throw error;
      }
    },
    async readUserDetails(id) {
      fastify.log.info('Entering readUserDetails method');
      try {
        const user = await users.findOne(
          { _id: id },
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
        );
        fastify.log.info('Exiting readUserDetails method');
        return user;
      } catch (error) {
        fastify.log.error({ error }, 'Error reading user details');
        throw error;
      }
    },
    async readUserById(id) {
      fastify.log.info('Entering readUserById method');
      try {
        const user = await users.findOne(
          { _id: id },
          {
            projection: {
              _id: 1,
              username: 1,
              email: 1,
              role: 1,
            },
          },
        );
        fastify.log.info('Exiting readUserById method');
        return user;
      } catch (error) {
        fastify.log.error({ error, id }, 'Failed to read user by ID');
        return null;
      }
    },
    async updateUser(id, newUser) {
      fastify.log.info('Entering updateUser method');
      try {
        const result = await users.updateOne(
          { _id: id },
          {
            $set: {
              ...newUser,
              modifiedAt: new Date(),
            },
          },
        );
        fastify.log.info('Exiting updateUser method');
        return result;
      } catch (error) {
        fastify.log.error({ error, id }, 'Error updating user');
        throw error;
      }
    },
    async deleteUser(id) {
      fastify.log.info('Entering deleteUser method');
      try {
        const res = await users.updateOne({ _id: id }, { $set: { deleted: true, deletedAt: new Date() } });

        if (res.modifiedCount === 0) {
          fastify.log.info({ userId: id }, "User for delete does not exist or user can't be deleted");
          return false;
        }

        await fastify.usersDataSource.deleteRevokedTokens(id);
        fastify.log.info('Exiting deleteUser method');
        return true;
      } catch (error) {
        fastify.log.error({ error, id }, 'Error deleting user');
        throw error;
      }
    },
    async getSoftDeletedUserById(userId) {
      fastify.log.info('Entering getSoftDeletedUserById method');
      try {
        const deletedUser = await users.findOne({ _id: userId, deleted: true }, {});
        fastify.log.info('Exiting getSoftDeletedUserById method');
        return deletedUser;
      } catch (error) {
        fastify.log.error({ error, userId }, 'Error getting soft deleted user');
        throw error;
      }
    },
    async setUserRoleById(userId, role) {
      fastify.log.info('Entering setUserRoleById method');
      try {
        await users.updateOne({ _id: userId }, { $set: { role } });
        fastify.log.info({ role, userId }, 'User set new role');
        fastify.log.info('Exiting setUserRoleById method');
        return true;
      } catch (error) {
        fastify.log.error({ error, userId }, 'Error setting user role');
        throw error;
      }
    },
    async getUsersWithRole(role) {
      fastify.log.info('Entering getUsersWithRole method');
      try {
        const usersList = await users.find({ role: role }, {}).toArray();
        fastify.log.info('Exiting getUsersWithRole method');
        return usersList;
      } catch (error) {
        fastify.log.error({ error, role }, 'Error getting users with role');
        throw error;
      }
    },
    async checkIfRevoked(jti) {
      fastify.log.info('Entering checkIfRevoked method');
      try {
        const token = await revokedTokens.findOne({ _id: jti, deleted: false });
        fastify.log.info('Exiting checkIfRevoked method');
        return !!token;
      } catch (error) {
        fastify.log.error({ error, jti }, 'Database check revoke failure');
        throw error;
      }
    },
    async revokeToken(jti) {
      fastify.log.info('Entering revokeToken method');
      try {
        await revokedTokens.updateOne(
          { _id: jti },
          { $set: { deleted: true, updatedAt: new Date() } },
          { upsert: true }
        );
        fastify.log.info({ jti }, 'Token revoked/disabled status on DB');
        fastify.log.info('Exiting revokeToken method');
      } catch (error) {
        fastify.log.error({ error, jti }, 'Database failure on token revoke');
        throw error;
      }
    },
    async deleteRevokedTokens(userId) {
      fastify.log.info('Entering deleteRevokedTokens method');
      try {
        const deleteResult = await revokedTokens.deleteMany({ userId });
        fastify.log.info({ userId, result: deleteResult }, 'Tokens removed (many on specific user id) on DB/Store');
        fastify.log.info('Exiting deleteRevokedTokens method');
      } catch (error) {
        fastify.log.error({ error, userId }, 'Error on bulk token revoke status');
        throw error;
      }
    },
  };

  fastify.decorate('usersDataSource', usersDataSource);
  fastify.log.info('Successfully registered users plugin');
}

module.exports = fp(usersPlugin, {
  name: 'users-store',
  encapsulate: true,
  dependencies: ['db-plugin'],
});