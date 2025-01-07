// 'use strict'
//
// const fp = require('fastify-plugin')
// const schemas = require('./schemas/loader')
// const { randomUUID } = require('node:crypto')
// const { ObjectId } = require('mongodb')
//
//
// module.exports = fp(
//   async function userAutoHooks(fastify) {
//     const users = fastify.mongo.db.collection('users')
//     const revokedTokensCollection = fastify.mongo.db.collection('revokedTokens')
//
//     fastify.register(schemas)
//
//
//     fastify.decorate('usersDataSource', {
//
//
//       async listUsers({ filter = {}, skip = 0, limit = 10 } = {}) {
//         return await users
//           .find(filter, {
//             projection: {
//               _id: 1,
//               username: 1,
//               email: 1,
//               firstName: 1,
//               lastName: 1,
//               role: 1,
//               createdAt: 1,
//               modifiedAt: 1,
//             },
//           })
//           .skip(skip)
//           .limit(limit)
//           .toArray()
//       },
//       async countUsers({ filter = {} } = {}) {
//         return await users.countDocuments(filter)
//       },
//       async readUserDetails(id) {
//         return await users.findOne(
//           { _id: id },
//           {
//             projection: {
//               _id: 1,
//               username: 1,
//               email: 1,
//               firstName: 1,
//               lastName: 1,
//               role: 1,
//               createdAt: 1,
//               modifiedAt: 1,
//             },
//           },
//         )
//       },
//       async readUserById(id) {
//         try {
//           return await users.findOne(
//             { _id: id },
//             {
//               projection: {
//                 _id: 1,
//                 username: 1,
//                 email: 1,
//                 role: 1,
//               },
//             },
//           )
//         } catch (err) {
//           fastify.log.error({ err, id }, 'Failed to read user by ID')
//           return null
//         }
//       },
//
//       async updateUser(id, newUser) {
//         return await users.updateOne(
//           { _id: id },
//           {
//             $set: {
//               ...newUser,
//               modifiedAt: new Date(),
//             },
//           },
//         )
//       },
//       async deleteUser(id) {
//         try {
//
//           //soft delete , the correct way ( if need keep for auditing cases and future access control ), by this case no more user information is accessible in public flows as /user, etc
//           const res = await users.updateOne({ _id: id }, { $set: { 'deleted': true, deletedAt: new Date() } }); //set  a  proper schema structure in db for deleted status, can have soft and hard delete
//
//           if (res.modifiedCount === 0) {
//             fastify.log.info({ userId: id }, ' User for delete does not exists or user can\'t be delete') // log
//             return false; //or throw
//           }
//           await this.deleteRevokedTokens(id)  // remove user revoke tokens when account delete, or if this user must have  other roles implementation also
//
//           return true; // ok , deleted
//
//         } catch (e) {
//           fastify.log.error({ id, error: e }, 'Error in deleting users ') // or log custom cases like for ex. with http code error handling system like @fastify/sensible
//
//           throw e;
//         }
//       },
//
//       async getSoftDeletedUserById(userId) {
//         // you can set on user profile view, admin interface
//         const deletedUser = await users.findOne({ _id: userId, 'deleted': true }, {});
//         return deletedUser;  // or throw
//
//       },
//
//
//       async setUserRoleById(userId, role) {
//         try {
//
//           await users.updateOne({ _id: userId }, { $set: { role } })
//           fastify.log.info({ role, userId }, `User set new role`);
//           return true
//         }
//         catch (e) {
//
//           fastify.log.error({ error: e }, 'error when set role')
//           throw e;
//         }
//       },
//
//
//       async getUsersWithRole(role) {
//         const users = await users.find({ role: role }, {}).toArray();
//         return users;
//
//       },
//
//       // REVOKE TOKEN OPERATIONS:
//       async checkIfRevoked(jti) {
//         try {
//           const token = await revokedTokens.findOne({ _id: jti, deleted: false })
//           return !!token // Return true if found (revoked), false otherwise
//         } catch (e) {
//           fastify.log.error({ error: e, jti }, 'Database check revok failure!')
//           throw e
//         }
//       },
//
//
//       async revokeToken(jti) {
//         try {
//           await revokedTokens.updateOne(
//             { _id: jti },
//             { $set: { deleted: true, updatedAt: new Date() } },
//             { upsert: true }
//           )
//           fastify.log.info({ jti }, 'Token revoked/disabled status on DB.')
//         } catch (e) {
//           fastify.log.error({ error: e, jti }, 'Database failure on token revoke!')
//           throw e
//         }
//       },
//
//       async deleteRevokedTokens(userId) {
//         try {
//           const deleteResult = await revokedTokens.deleteMany({ userId })
//           fastify.log.info({ userId, result: deleteResult }, 'Tokens removed (many on specific user id) on DB/Store')
//         } catch (e) {
//           fastify.log.error({ error: e }, 'Error on bulk token revoke status.')
//           throw e
//         }
//       }
//     })
//   },
//   { encapsulate: true, dependencies: ['@fastify/mongodb'] },
// )