'use strict'

module.exports = async function noteRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate)

  fastify.route({
    method: 'GET',
    url: '/',
    schema: {
      tags: ['notes'],
      summary: 'List notes',
      querystring: { $ref: 'schema:note:list:query#' },
      response: {
        200: { $ref: 'schema:note:list:response#' },
      },
    },
    handler: async function listNotesHandler(request, reply) {
      const { skip, limit, title } = request.query
      
      const notes = await fastify.notesDataSource.listNotes({
        filter: { title },
        skip,
        limit,
      }, request.user._id)
      
      const totalCount = await fastify.notesDataSource.countNotes({ filter }, request.user._id)
      
      return { data: notes, totalCount }
    },
  })

  fastify.route({
    method: 'POST',
    url: '/',
    schema: {
      tags: ['notes'],
      summary: 'Create a note',
      body: { $ref: 'schema:note:create:body#' },
      response: {
        201: { $ref: 'schema:note#' },
      },
    },
    handler: async function createNoteHandler(request, reply) {
      const { title, body, tags } = request.body
      
      const note = await fastify.notesDataSource.createNote({
        title,
        body,
        tags,
      }, request.user._id)
      
      reply.code(201)
      return { data: note }
    },
  })

  fastify.route({
    method: 'GET',
    url: '/:id',
    schema: {
      tags: ['notes'],
      summary: 'Read a note by id',
      params: { $ref: 'schema:note:read:params#' },
      response: {
        200: {
          type: 'object',
          properties: {
            data: { $ref: 'schema:note#' }
          }
        }
      },
    },
    handler: async function readNoteHandler(request, reply) {
      const { id } = request.params
      const note = await fastify.notesDataSource.readNote(id, request.user._id)
      
      if (!note) {
        throw fastify.httpErrors.notFound('Note not found')
      }
      return { data: note }
    },
  })

  fastify.route({
    method: 'PUT',
    url: '/:id',
    schema: {
      tags: ['notes'],
      summary: 'Update a note by id',
      params: { $ref: 'schema:note:read:params#' },
      body: { $ref: 'schema:note:update:body#' },
      response: {
        200: {
          type: 'object',
          properties: {
            data: { $ref: 'schema:note#' }
          }
        }
      },
    },
    handler: async function updateNoteHandler(request, reply) {
      const { id } = request.params
      const updateData = request.body
      
      const updatedNote = await fastify.notesDataSource.updateNote(id, updateData, request.user._id)
      
      if (!updatedNote) {
        throw fastify.httpErrors.notFound('Note not found')
      }
      return { data: updatedNote }
    },
  })

  fastify.route({
    method: 'DELETE',
    url: '/:id',
    schema: {
      tags: ['notes'],
      summary: 'Delete a note by id',
      params: { $ref: 'schema:note:read:params#' },
    },
    handler: async function deleteNoteHandler(request, reply) {
      const { id } = request.params
      
      const success = await fastify.notesDataSource.deleteNote(id, request.user._id)
      
      if (!success) {
         throw fastify.httpErrors.notFound('Note not found or already deleted')
      }
      
      reply.code(204).send()
    },
  })
}

module.exports.autoPrefix = '/notes'