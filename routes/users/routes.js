// 'use strict'

// const fp = require('fastify-plugin')

// module.exports = fp(async function userRoutes(fastify) {
//   // Protect all /users routes with authentication
//   fastify.addHook('onRequest', fastify.authenticate)
//   // Additionally, protect /users routes with authorization (e.g., only admins)
//   fastify.addHook('preHandler', fastify.authorize(['admin']))

//   fastify.route({
//     method: 'GET',
//     url: '/users',
//     schema: {
//       tags: ['users'],
//       summary: 'List users',
//       headers: fastify.getSchema('schema:auth:token-header'),
//       querystring: {
//         type: 'object',
//         properties: {
//           skip: { type: 'integer', default: 0 },
//           limit: { type: 'integer', default: 10 },
//           username: { type: 'string' },
//         },
//         required: [], // This can be removed as it's an empty array, and the default behavior is to not require any properties
//       },
//       response: {
//         200: {
//           type: 'object',
//           properties: {
//             data: { type: 'array', items: fastify.getSchema('users/schemas/schema:user') },
//             totalCount: { type: 'integer' },
//           },
//         },
//         400: {
//           type: 'object',
//           properties: {
//             error: { type: 'string' },
//             message: { type: 'string' },
//             statusCode: { type: 'integer' },
//           },
//           required: ['error', 'message', 'statusCode'],
//         },
//       },
//     },
//     handler: async function listUsers(request, reply) {
//       try {
//         const { skip, limit, username } = request.query
//         if (!Number.isInteger(skip) || skip < 0 || !Number.isInteger(limit) || limit < 0) {
//           throw fastify.httpErrors.badRequest('Skip and limit must be non-negative integers');
//         }

//         const filter = username ? { username } : {}
//         const users = await fastify.usersDataSource.listUsers({ filter, skip, limit })
//         const totalCount = await fastify.usersDataSource.countUsers({ filter })
//         return { data: users, totalCount }
//       } catch (error) {
//         throw fastify.httpErrors.badRequest('Bad request', error.message);
//       }
//     },
//   })

//   fastify.route({
//     method: 'GET',
//     url: '/user-details/:id',
//     schema: {
//       tags: ['users'],
//       summary: 'Read user details',
//       headers: fastify.getSchema('auth/schemas/schema:auth:token-header'),
//       params: fastify.getSchema('users/schemas/schema:user:read:params'),
//       response: {
//         200: {
//           type: 'object',
//           properties: {
//             data: fastify.getSchema('users/schemas/schema:user'),
//           },
//         },
//         404: {
//           type: 'object',
//           properties: {
//             error: { type: 'string' }
//           }
//         }
//       },
//     },
//     handler: async function readUserDetails(request, reply) {
//       try {
//         const user = await fastify.usersDataSource.readUserDetails(request.params.id)
//         if (!user) {
//           throw fastify.httpErrors.notFound('User not found');
//         }

//         return { data: user }
//       } catch (error) {
//         if (error.statusCode === 404) throw error;
//         throw fastify.httpErrors.internalServerError('Internal Server Error');
//       }
//     },
//   })

//   fastify.route({
//     method: 'GET',
//     url: '/user/:id',
//     schema: {
//       tags: ['users'],
//       summary: 'Read user by id',
//       headers: fastify.getSchema('auth/schemas/schema:auth:token-header'),
//       params: fastify.getSchema('users/schemas/schema:user:read:params'),
//       response: {
//         200: fastify.getSchema('users/schemas/schema:user'),
//         404: {
//           type: 'object',
//           properties: {
//             error: { type: 'string' }
//           }
//         }
//       },
//     },
//     handler: async function readUser(request, reply) {
//       const user = await fastify.usersDataSource.readUserById(request.params.id)
//       if (!user) {
//         throw fastify.httpErrors.notFound('User not found');
//       }
//       return user
//     },
//   })

//   fastify.route({
//     method: 'PUT',
//     url: '/user/:id',
//     schema: {
//       tags: ['users'],
//       summary: 'Update user by id',
//       headers: fastify.getSchema('auth/schemas/schema:auth:token-header'),
//       params: fastify.getSchema('users/schemas/schema:user:read:params'),
//       body: fastify.getSchema('users/schemas/schema:user:update:body'),
//     },
//     handler: async function updateUser(request, reply) {
//       const res = await fastify.usersDataSource.updateUser(request.params.id, request.body)
//       if (res.modifiedCount === 0) {
//         throw fastify.httpErrors.notFound('User not found or not updated');
//       }
//       reply.code(204)
//     },
//   })

//   fastify.route({
//     method: 'DELETE',
//     url: '/user/:id',
//     schema: {
//       tags: ['users'],
//       summary: 'Delete user by id',
//       headers: fastify.getSchema('auth/schemas/schema:auth:token-header'),
//       params: fastify.getSchema('users/schemas/schema:user:read:params'),
//     },
//     handler: async function deleteUser(request, reply) {
//       const res = await fastify.usersDataSource.deleteUser(request.params.id)
//       if (!res) {
//         throw fastify.httpErrors.notFound('User not found');
//       }
//       reply.code(204)
//     },
//   })
// }, {
//   name: 'user-routes',
//   dependencies: ['authentication-plugin', 'users-store'],
//   encapsulate: true,
// })