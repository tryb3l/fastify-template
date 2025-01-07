// 'use strict'

// const fp = require('fastify-plugin')

// module.exports = fp(async function noteRoutes(fastify) {
//   fastify.addHook('onRequest', fastify.authenticate)
//   fastify.addHook('preHandler', fastify.addUserIdHook)

//   fastify.route({
//     method: 'GET',
//     url: '/',
//     schema: {
//       tags: ['notes'],
//       summary: 'List notes',
//       querystring: fastify.getSchema('notes/schemas/schema:note:list:query'),
//       response: {
//         200: fastify.getSchema('notes/schemas/schema:note:list:response'),
//       },
//     },
//     handler: async function listNotesHandler(request, reply) {
//       const { skip, limit, title } = request.query
//       // Additionally, handle the errors with fastify.httpErrors
//       if (skip < 0 || limit < 0) {
//         throw fastify.httpErrors.badRequest('Skip and limit must be non-negative integers')
//       }
//       const notes = await request.notesDataSource.listNotes({
//         filter: { title },
//         skip,
//         limit,
//       })
//       const totalCount = await request.notesDataSource.countNotes()
//       reply.code(200)
//       return { data: notes, totalCount }
//     },
//   })

//   fastify.route({
//     method: 'POST',
//     url: '/',
//     schema: {
//       tags: ['notes'],
//       summary: 'Create a note',
//       body: fastify.getSchema('notes/schemas/schema:note:create:body'),
//       response: {
//         201: fastify.getSchema('notes/schemas/schema:note'),
//       },
//     },
//     handler: async function createNoteHandler(request, reply) {
//       const { title, body, tags } = request.body
//       try {
//         const note = await request.notesDataSource.createNote({
//           title,
//           body,
//           tags,
//         })
//         reply.code(201)
//         return { data: note }
//       } catch (error) {
//         request.log.error({ err: error }, 'Error creating note')
//         throw fastify.httpErrors.internalServerError('Internal Server Error')
//       }
//     },
//   })

//   fastify.route({
//     method: 'GET',
//     url: '/:id',
//     schema: {
//       tags: ['notes'],
//       summary: 'Read a note by id',
//       querystring: fastify.getSchema('notes/schemas/schema:note:read:params'),
//       response: {
//         200: fastify.getSchema('notes/schemas/schema:note'),
//         404: {
//           type: 'object',
//           properties: {
//             statusCode: { type: 'integer' },
//             error: { type: 'string' },
//             message: { type: 'string' },
//           },
//         },
//         401: {
//           type: 'object',
//           properties: {
//             statusCode: { type: 'integer' },
//             error: { type: 'string' },
//             message: { type: 'string' },
//           },
//         },
//       },
//     },
//     handler: async function readNoteHandler(request, reply) {
//       try {
//         const { id } = request.params
//         const note = await request.notesDataSource.readNote(id)
//         if (!note) {
//           throw fastify.httpErrors.notFound('Note not found')
//         }
//         return { data: note }
//       } catch (error) {
//         if (error.statusCode === 404) throw error;
//         request.log.error({ err: error, id }, 'Failed to read note')
//         throw fastify.httpErrors.internalServerError('Internal server error')
//       }
//     },
//   })

//   fastify.route({
//     method: 'PUT',
//     url: '/',
//     schema: {
//       tags: ['notes'],
//       summary: 'Update a note by id',
//       body: fastify.getSchema('notes/schemas/schema:note:update:body'),
//       response: {
//         200: fastify.getSchema('notes/schemas/schema:note'),
//         404: {
//           type: 'object',
//           properties: {
//             statusCode: { type: 'integer' },
//             error: { type: 'string' },
//             message: { type: 'string' },
//           },
//         },
//       },
//     },
//     handler: async function updateNoteHandler(request, reply) {
//       const { id, ...updateData } = request.body
//       const updatedNote = await request.notesDataSource.updateNote(id, updateData)
//       if (!updatedNote) {
//         throw fastify.httpErrors.notFound('Note not found')
//       }
//       return { data: updatedNote }
//     },
//   })

//   fastify.route({
//     method: 'DELETE',
//     url: '/:id',
//     schema: {
//       tags: ['notes'],
//       summary: 'Delete a note by id',
//       querystring: fastify.getSchema('notes/schemas/schema:note:read:params'),
//       response: {
//         204: {
//           type: 'object'
//         },
//         404: {
//           type: 'object',
//           properties: {
//             statusCode: { type: 'integer' },
//             error: { type: 'string' },
//             message: { type: 'string' },
//           },
//         },
//       }
//     },
//     handler: async function deleteNoteHandler(request, reply) {
//       const { id } = request.params
//       await request.notesDataSource.deleteNote(id)
//       reply.code(204)
//     },
//   })
// },
//   {
//     name: 'note-routes',
//     encapsulate: true,
//     dependencies: ['authentication-plugin', 'notes-store'],
//   },
// )