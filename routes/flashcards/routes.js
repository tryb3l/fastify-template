'use strict'

module.exports = async function flashcardRoutes(fastify, opts) {
  const nodeEnv =
    opts?.configData?.NODE_ENV ||
    fastify.config?.NODE_ENV ||
    fastify.secrets?.NODE_ENV ||
    process.env.NODE_ENV
  const flashcardsRateLimit = {
    max: nodeEnv === 'test' ? 30 : 120,
    timeWindow: '1 minute',
  }

  fastify.route({
    method: 'POST',
    url: '/',
    config: { rateLimit: flashcardsRateLimit },
    schema: {
      tags: ['flashcards'],
      summary: 'Create a flashcard attached to a note',
      body: { $ref: 'schema:flashcard:create:body#' },
      response: {
        201: {
          type: 'object',
          additionalProperties: false,
          required: ['data'],
          properties: {
            data: { $ref: 'schema:flashcard#' },
          },
        },
      },
    },
    handler: async function createFlashcardHandler(request, reply) {
      const card = await request.flashcardsDataSource.createFlashcard(request.body)
      reply.code(201)
      return { data: card }
    },
  })

  fastify.route({
    method: 'GET',
    url: '/',
    config: { rateLimit: flashcardsRateLimit },
    schema: {
      tags: ['flashcards'],
      summary: 'List flashcards filtered by noteId, notebookId, folderId, or Leitner box',
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          noteId: { type: 'string', format: 'uuid' },
          notebookId: { type: 'string', format: 'uuid' },
          folderId: { type: 'string', format: 'uuid' },
          box: { type: 'integer', minimum: 1, maximum: 5 },
        },
      },
      response: {
        200: {
          type: 'object',
          additionalProperties: false,
          required: ['data'],
          properties: {
            data: {
              type: 'array',
              items: { $ref: 'schema:flashcard#' },
            },
          },
        },
      },
    },
    handler: async function listFlashcardsHandler(request) {
      const cards = await request.flashcardsDataSource.listFlashcards(request.query)
      return { data: cards }
    },
  })

  fastify.route({
    method: 'GET',
    url: '/drill',
    config: { rateLimit: flashcardsRateLimit },
    schema: {
      tags: ['flashcards'],
      summary:
        'Fetch flashcards for a scheduled spaced-repetition or cram_all drill session across a Notebook, Campaign, Folder, or Note',
      querystring: { $ref: 'schema:flashcard:drill:query#' },
      response: {
        200: {
          type: 'object',
          additionalProperties: false,
          required: ['data'],
          properties: {
            data: {
              type: 'array',
              items: { $ref: 'schema:flashcard:drill:item#' },
            },
          },
        },
      },
    },
    handler: async function drillFlashcardsHandler(request) {
      const cards = await request.flashcardsDataSource.drillFlashcards(request.query)
      return { data: cards }
    },
  })

  fastify.route({
    method: 'GET',
    url: '/:id',
    config: { rateLimit: flashcardsRateLimit },
    schema: {
      tags: ['flashcards'],
      summary: 'Read a flashcard by id',
      params: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      response: {
        200: {
          type: 'object',
          additionalProperties: false,
          required: ['data'],
          properties: {
            data: { $ref: 'schema:flashcard#' },
          },
        },
      },
    },
    handler: async function readFlashcardHandler(request) {
      const card = await request.flashcardsDataSource.readFlashcard(request.params.id)
      return { data: card }
    },
  })

  fastify.route({
    method: 'PUT',
    url: '/:id',
    config: { rateLimit: flashcardsRateLimit },
    schema: {
      tags: ['flashcards'],
      summary: 'Update a flashcard front or back prompt',
      params: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      body: { $ref: 'schema:flashcard:update:body#' },
      response: {
        200: {
          type: 'object',
          additionalProperties: false,
          required: ['data'],
          properties: {
            data: { $ref: 'schema:flashcard#' },
          },
        },
      },
    },
    handler: async function updateFlashcardHandler(request) {
      const card = await request.flashcardsDataSource.updateFlashcard(
        request.params.id,
        request.body,
      )
      return { data: card }
    },
  })

  fastify.route({
    method: 'DELETE',
    url: '/:id',
    config: { rateLimit: flashcardsRateLimit },
    schema: {
      tags: ['flashcards'],
      summary: 'Delete a flashcard by id',
      params: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      response: {
        204: { type: 'null' },
      },
    },
    handler: async function deleteFlashcardHandler(request, reply) {
      await request.flashcardsDataSource.deleteFlashcard(request.params.id)
      reply.code(204).send()
    },
  })

  fastify.route({
    method: 'POST',
    url: '/:id/review',
    config: { rateLimit: flashcardsRateLimit },
    schema: {
      tags: ['flashcards'],
      summary:
        'Submit a Leitner recall rating (again | hard | good) for a flashcard and synchronize parent note readiness',
      params: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      body: { $ref: 'schema:flashcard:review:body#' },
      response: {
        200: {
          type: 'object',
          additionalProperties: false,
          required: ['data'],
          properties: {
            data: {
              type: 'object',
              additionalProperties: false,
              required: ['flashcard', 'noteReadiness'],
              properties: {
                flashcard: { $ref: 'schema:flashcard#' },
                noteReadiness: {
                  type: 'string',
                  enum: ['to_review', 'in_progress', 'mastered'],
                },
              },
            },
          },
        },
      },
    },
    handler: async function reviewFlashcardHandler(request) {
      const result = await request.flashcardsDataSource.reviewFlashcard(
        request.params.id,
        request.body.rating,
      )
      return { data: result }
    },
  })
}

module.exports.autoPrefix = '/flashcards'
