'use strict'

module.exports = async function noteRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate)

  fastify.route({
    method: 'GET',
    url: '/',
    schema: {
      tags: ['notes'],
      summary: 'List notes',
      headers: { $ref: 'schema:auth:token-header#' },
      querystring: { $ref: 'schema:note:list:query#' },
      response: {
        200: { $ref: 'schema:note:list:response#' },
      },
    },
    handler: async function listNotesHandler(request, reply) {
      const { skip, limit, title } = request.query
      if (skip < 0 || limit < 0) {
        throw fastify.httpErrors.badRequest('Skip and limit must be non-negative integers')
      }
      const notes = await request.notesDataSource.listNotes({
        filter: { title },
        skip,
        limit,
      }, request.user.id )
      const totalCount = await request.notesDataSource.countNotes()
      reply.code(200)
      return { data: notes, totalCount }
    },
  })

  fastify.route({
    method: 'POST',
    url: '/',
    schema: {
      tags: ['notes'],
      summary: 'Create a note',
      headers: { $ref: 'schema:auth:token-header#' },
      body: { $ref: 'schema:note:create:body#' },
      response: {
        201: { $ref: 'schema:note#' },
      },
    },
    handler: async function createNoteHandler(request, reply) {
      const { title, body, tags } = request.body
      try {
        const note = await request.notesDataSource.createNote({
          title,
          body,
          tags,
        }, request.user.id )
        reply.code(201)
        return { data: note }
      } catch (error) {
        request.log.error({ err: error }, 'Error creating note')
        throw fastify.httpErrors.internalServerError('Internal Server Error')
      }
    },
  })

  fastify.route({
    method: 'GET',
    url: '/:id',
    schema: {
      tags: ['notes'],
      summary: 'Read a note by id',
      headers: { $ref: 'schema:auth:token-header#' },
      params: { $ref: 'schema:note:read:params#' },
      response: {
        200: { $ref: 'schema:note#' },
        404: {
          type: 'object',
          properties: {
            statusCode: { type: 'integer' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
        401: {
          type: 'object',
          properties: {
            statusCode: { type: 'integer' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    handler: async function readNoteHandler(request, reply) {
      try {
        const { id } = request.params
        const note = await request.notesDataSource.readNote(id, request.user.id)
        if (!note) {
          throw fastify.httpErrors.notFound('Note not found')
        }
        return { data: note }
      } catch (error) {
        if (error.statusCode === 404) throw error;
        request.log.error({ err: error, id }, 'Failed to read note')
        throw fastify.httpErrors.internalServerError('Internal server error')
      }
    },
  })

  fastify.route({
    method: 'PUT',
    url: '/',
    schema: {
      tags: ['notes'],
      summary: 'Update a note by id',
      headers: { $ref: 'schema:auth:token-header#' },
      body: { $ref: 'schema:note:update:body#' },
      response: {
        200: { $ref: 'schema:note#' },
        404: {
          type: 'object',
          properties: {
            statusCode: { type: 'integer' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    handler: async function updateNoteHandler(request, reply) {
      const { id, ...updateData } = request.body
      const updatedNote = await request.notesDataSource.updateNote(id, updateData, request.user.id)
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
      headers: { $ref: 'schema:auth:token-header#' },
      params: { $ref: 'schema:note:read:params#' },
      response: {
        204: {
          type: 'object'
        },
        404: {
          type: 'object',
          properties: {
            statusCode: { type: 'integer' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      }
    },
    handler: async function deleteNoteHandler(request, reply) {
      const { id } = request.params
      await request.notesDataSource.deleteNote(id, request.user.id)
      reply.code(204)
    },
  })
}