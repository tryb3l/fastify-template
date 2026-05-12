'use strict'

const { NOTE_LIST_PROJECTION } = require('./query-shapes')

module.exports = async function noteRoutes(fastify, opts) {
  const nodeEnv =
    opts?.configData?.NODE_ENV ||
    fastify.config?.NODE_ENV ||
    fastify.secrets?.NODE_ENV ||
    process.env.NODE_ENV
  const notesRateLimit = {
    max: nodeEnv === 'test' ? 5 : 30,
    timeWindow: '1 minute',
  }

  fastify.route({
    method: 'GET',
    url: '/',
    config: {
      rateLimit: notesRateLimit,
    },
    schema: {
      tags: ['notes'],
      summary: 'List notes',
      querystring: { $ref: 'schema:note:list:query#' },
      response: {
        200: { $ref: 'schema:note:list:response#' },
      },
    },
    handler: async function listNotesHandler(request) {
      const { skip, limit, title } = request.query
      const notes = await fastify.notesDataSource.listNotes(
        { filter: { title }, projection: NOTE_LIST_PROJECTION, skip, limit },
        request.user._id,
      )
      const totalCount = await fastify.notesDataSource.countNotes({ title }, request.user._id)
      return { data: notes, totalCount }
    },
  })

  fastify.route({
    method: 'POST',
    url: '/',
    config: {
      rateLimit: notesRateLimit,
    },
    schema: {
      tags: ['notes'],
      summary: 'Create a note',
      body: { $ref: 'schema:note:create:body#' },
      response: {
        201: {
          type: 'object',
          properties: { data: { $ref: 'schema:note#' } },
        },
      },
    },
    handler: async function createNoteHandler(request, reply) {
      const { title, body, tags } = request.body
      const note = await fastify.notesDataSource.createNote({ title, body, tags }, request.user._id)
      reply.code(201)
      return { data: note }
    },
  })

  fastify.route({
    method: 'GET',
    url: '/:id',
    config: {
      rateLimit: notesRateLimit,
    },
    schema: {
      tags: ['notes'],
      summary: 'Read a note by id',
      params: { $ref: 'schema:note:read:params#' },
      response: {
        200: {
          type: 'object',
          properties: { data: { $ref: 'schema:note#' } },
        },
      },
    },
    handler: async function readNoteHandler(request) {
      const { id } = request.params
      const userId = request.user._id || request.user.id
      const cacheKey = `note:${id}:${userId}`

      const cached = await fastify.cacheGet(cacheKey)
      if (cached && cached.item) {
        request.log.info('Cache HIT - Serving from RAM')
        return { data: cached.item }
      }

      request.log.info('Cache MISS - Fetching from MongoDB')
      const note = await fastify.notesDataSource.readNote(id, userId)

      await fastify.cacheSet(cacheKey, note, 300000)

      return { data: note }
    },
  })

  fastify.route({
    method: 'PUT',
    url: '/:id',
    config: {
      rateLimit: notesRateLimit,
    },
    schema: {
      tags: ['notes'],
      summary: 'Update a note by id',
      params: { $ref: 'schema:note:read:params#' },
      body: { $ref: 'schema:note:update:body#' },
      response: {
        200: {
          type: 'object',
          properties: { data: { $ref: 'schema:note#' } },
        },
        409: {
          type: 'object',
          additionalProperties: false,
          properties: {
            message: { type: 'string' },
            code: { type: 'string' },
            currentModifiedAt: { type: 'string', format: 'date-time' },
          },
          required: ['message', 'code', 'currentModifiedAt'],
        },
      },
    },
    handler: async function updateNoteHandler(request, reply) {
      const { id } = request.params
      const userId = request.user._id || request.user.id
      const updateData = request.body

      let updatedNote

      try {
        updatedNote = await fastify.notesDataSource.updateNote(id, updateData, userId)
      } catch (error) {
        if (error?.statusCode === 409 && error.conflictCode === 'NOTE_STALE_SAVE') {
          reply.code(409)
          return {
            message: error.message,
            code: error.conflictCode,
            currentModifiedAt:
              error.currentModifiedAt instanceof Date
                ? error.currentModifiedAt.toISOString()
                : error.currentModifiedAt,
          }
        }

        throw error
      }

      if (fastify.auditLog) {
        fastify.auditLog({
          request,
          action: 'note_updated',
          userId,
          resourceType: 'note',
          resourceId: id,
        })
      }

      if (fastify.eventBus) {
        const sanitizedEventDTO = {
          id: updatedNote.id,
          title: updatedNote.title,
          body: updatedNote.body,
          tags: updatedNote.tags,
          modifiedAt: updatedNote.modifiedAt,
        }
        fastify.eventBus.emit(`note_updated:${id}`, {
          type: 'NOTE_UPDATED',
          payload: sanitizedEventDTO,
        })
      }

      return { data: updatedNote }
    },
  })

  fastify.route({
    method: 'DELETE',
    url: '/:id',
    config: {
      rateLimit: notesRateLimit,
    },
    schema: {
      tags: ['notes'],
      summary: 'Delete a note by id',
      params: { $ref: 'schema:note:read:params#' },
    },
    handler: async function deleteNoteHandler(request, reply) {
      const { id } = request.params
      const userId = request.user._id || request.user.id

      await fastify.notesDataSource.deleteNote(id, userId)

      if (fastify.auditLog) {
        fastify.auditLog({
          request,
          action: 'note_deleted',
          userId,
          resourceType: 'note',
          resourceId: id,
        })
      }

      reply.code(204).send()
    },
  })
}

module.exports.autoPrefix = '/notes'
