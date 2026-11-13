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
      const { skip, limit, title, readiness, noteType, notebookId, folderId, inbox } = request.query
      const filter = { title, readiness, noteType }
      if (inbox === true) {
        filter.notebookId = null
        filter.folderId = null
      } else {
        if (notebookId !== undefined) filter.notebookId = notebookId
        if (folderId !== undefined) filter.folderId = folderId
      }

      const [notes, totalCount] = await Promise.all([
        request.notesDataSource.listNotes({
          filter,
          projection: NOTE_LIST_PROJECTION,
          skip,
          limit,
        }),
        request.notesDataSource.countNotes(filter),
      ])
      return { data: notes, totalCount }
    },
  })

  fastify.route({
    method: 'GET',
    url: '/sync',
    config: {
      rateLimit: notesRateLimit,
    },
    schema: {
      tags: ['notes'],
      summary:
        'Get workspace delta changes (Notes, Notebooks, Folders, and deletions) since a timestamp',
      querystring: {
        type: 'object',
        additionalProperties: false,
        required: ['since'],
        properties: {
          since: { type: 'string', format: 'date-time' },
          limit: { type: 'integer', minimum: 1, maximum: 1000, default: 500 },
          cursor: { type: 'string', minLength: 1, maxLength: 1024 },
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
              required: [
                'serverTime',
                'hasMore',
                'nextCursor',
                'notes',
                'notebooks',
                'folders',
                'flashcards',
              ],
              properties: {
                serverTime: { type: 'string', format: 'date-time' },
                hasMore: { type: 'boolean' },
                nextCursor: { type: ['string', 'null'] },
                notes: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['upserted', 'deletedIds'],
                  properties: {
                    upserted: { type: 'array', items: { $ref: 'schema:note#' } },
                    deletedIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
                  },
                },
                notebooks: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['upserted', 'deletedIds'],
                  properties: {
                    upserted: {
                      type: 'array',
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        required: [
                          'id',
                          'name',
                          'description',
                          'mode',
                          'status',
                          'targetDate',
                          'createdAt',
                          'modifiedAt',
                        ],
                        properties: {
                          id: { type: 'string', format: 'uuid' },
                          name: { type: 'string' },
                          description: { type: 'string' },
                          mode: { type: 'string', enum: ['notebook', 'campaign'] },
                          status: { type: 'string', enum: ['active', 'archived'] },
                          targetDate: { type: ['string', 'null'], format: 'date-time' },
                          createdAt: { type: 'string', format: 'date-time' },
                          modifiedAt: { type: 'string', format: 'date-time' },
                        },
                      },
                    },
                    deletedIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
                  },
                },
                folders: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['upserted', 'deletedIds'],
                  properties: {
                    upserted: {
                      type: 'array',
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        required: [
                          'id',
                          'notebookId',
                          'parentId',
                          'name',
                          'createdAt',
                          'modifiedAt',
                        ],
                        properties: {
                          id: { type: 'string', format: 'uuid' },
                          notebookId: { type: 'string', format: 'uuid' },
                          parentId: { type: ['string', 'null'], format: 'uuid' },
                          name: { type: 'string' },
                          createdAt: { type: 'string', format: 'date-time' },
                          modifiedAt: { type: 'string', format: 'date-time' },
                        },
                      },
                    },
                    deletedIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
                  },
                },
                flashcards: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['upserted', 'deletedIds'],
                  properties: {
                    upserted: { type: 'array', items: { $ref: 'schema:flashcard#' } },
                    deletedIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
                  },
                },
              },
            },
          },
        },
        410: {
          type: 'object',
          additionalProperties: false,
          required: ['message', 'code'],
          properties: {
            message: { type: 'string' },
            code: { type: 'string' },
          },
        },
      },
    },
    handler: async function getWorkspaceSyncDeltaHandler(request) {
      const delta = await request.notesDataSource.getWorkspaceSyncDelta(request.query.since, {
        limit: request.query.limit,
        cursor: request.query.cursor,
      })
      return { data: delta }
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
          includeExternal: { type: 'boolean', default: true },
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
                    required: [
                      'id',
                      'title',
                      'tags',
                      'readiness',
                      'noteType',
                      'notebookId',
                      'folderId',
                      'homeNotebookId',
                      'isExternal',
                      'modifiedAt',
                    ],
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      title: { type: 'string' },
                      tags: { type: 'array', items: { type: 'string' } },
                      readiness: {
                        type: 'string',
                        enum: ['to_review', 'in_progress', 'mastered'],
                      },
                      noteType: {
                        type: 'string',
                        enum: ['standard', 'post_mortem'],
                      },
                      notebookId: { type: ['string', 'null'], format: 'uuid' },
                      folderId: { type: ['string', 'null'], format: 'uuid' },
                      homeNotebookId: { type: ['string', 'null'], format: 'uuid' },
                      isExternal: { type: 'boolean' },
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
