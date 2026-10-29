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
      const { skip, limit, title, notebookId, folderId, inbox } = request.query
      const filter = { title }
      if (inbox === true) {
        filter.notebookId = null
        filter.folderId = null
      } else {
        if (notebookId !== undefined) filter.notebookId = notebookId
        if (folderId !== undefined) filter.folderId = folderId
      }

      const notes = await request.notesDataSource.listNotes({
        filter,
        projection: NOTE_LIST_PROJECTION,
        skip,
        limit,
      })
      const totalCount = await request.notesDataSource.countNotes(filter)
      return { data: notes, totalCount }
    },
  })

  fastify.route({
    method: 'GET',
    url: '/graph',
    config: {
      rateLimit: notesRateLimit,
    },
    schema: {
      tags: ['notes'],
      summary: 'Get poly-hierarchical mind-map graph of notes and note links',
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          rootNoteId: { type: 'string', format: 'uuid' },
          notebookId: { type: 'string', format: 'uuid' },
          folderId: { type: 'string', format: 'uuid' },
          maxDepth: { type: 'integer', minimum: 1, maximum: 5, default: 3 },
        },
      },
      response: {
        200: {
          type: 'object',
          additionalProperties: false,
          required: ['data'],
          properties: {
            data: {
              type: 'object',
              additionalProperties: false,
              required: ['nodes', 'edges'],
              properties: {
                nodes: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['id', 'title', 'tags', 'notebookId', 'folderId', 'modifiedAt'],
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      title: { type: 'string' },
                      tags: { type: 'array', items: { type: 'string' } },
                      notebookId: { type: ['string', 'null'], format: 'uuid' },
                      folderId: { type: ['string', 'null'], format: 'uuid' },
                      modifiedAt: { type: 'string', format: 'date-time' },
                    },
                  },
                },
                edges: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['sourceId', 'targetId', 'relation'],
                    properties: {
                      sourceId: { type: 'string', format: 'uuid' },
                      targetId: { type: 'string', format: 'uuid' },
                      relation: { type: 'string', enum: ['parent', 'child', 'related'] },
                      label: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    handler: async function getMindMapGraphHandler(request) {
      const graph = await request.notesDataSource.getMindMapGraph(request.query)
      return { data: graph }
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
      const note = await request.notesDataSource.createNote(request.body)
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
      const note = await request.notesDataSource.readNote(id)
      return { data: note }
    },
  })

  fastify.route({
    method: 'GET',
    url: '/:id/backlinks',
    config: {
      rateLimit: notesRateLimit,
    },
    schema: {
      tags: ['notes'],
      summary: 'List incoming backlinks for a note',
      params: { $ref: 'schema:note:read:params#' },
      response: {
        200: {
          type: 'object',
          additionalProperties: false,
          required: ['data'],
          properties: {
            data: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['sourceId', 'title', 'notebookId', 'folderId', 'relation', 'modifiedAt'],
                properties: {
                  sourceId: { type: 'string', format: 'uuid' },
                  title: { type: 'string' },
                  notebookId: { type: ['string', 'null'], format: 'uuid' },
                  folderId: { type: ['string', 'null'], format: 'uuid' },
                  relation: { type: 'string', enum: ['parent', 'child', 'related'] },
                  label: { type: 'string' },
                  modifiedAt: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
      },
    },
    handler: async function listBacklinksHandler(request) {
      const backlinks = await request.notesDataSource.listBacklinks(request.params.id)
      return { data: backlinks }
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
            currentRevision: { type: 'integer' },
            currentModifiedAt: { type: 'string', format: 'date-time' },
          },
          required: ['message', 'code', 'currentRevision', 'currentModifiedAt'],
        },
      },
    },
    handler: async function updateNoteHandler(request) {
      const updatedNote = await request.notesDataSource.updateNote(request.params.id, request.body)
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
      querystring: { $ref: 'schema:note:delete:query#' },
      response: {
        204: { type: 'null' },
        409: {
          type: 'object',
          additionalProperties: false,
          properties: {
            message: { type: 'string' },
            code: { type: 'string' },
            currentRevision: { type: 'integer' },
            currentModifiedAt: { type: 'string', format: 'date-time' },
          },
          required: ['message', 'code', 'currentRevision', 'currentModifiedAt'],
        },
      },
    },
    handler: async function deleteNoteHandler(request, reply) {
      await request.notesDataSource.deleteNote(request.params.id, request.query.expectedRevision)
      reply.code(204).send()
    },
  })
}

module.exports.autoPrefix = '/notes'
