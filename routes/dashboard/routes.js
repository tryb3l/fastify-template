'use strict'

const readinessSummarySchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'toReviewCount',
    'inProgressCount',
    'masteredCount',
    'totalCount',
    'scorePercent',
    'blocks',
  ],
  properties: {
    toReviewCount: { type: 'integer', minimum: 0 },
    inProgressCount: { type: 'integer', minimum: 0 },
    masteredCount: { type: 'integer', minimum: 0 },
    totalCount: { type: 'integer', minimum: 0 },
    scorePercent: { type: 'integer', minimum: 0, maximum: 100 },
    blocks: { type: 'integer', minimum: 0, maximum: 10 },
  },
}

const activeContainerSummarySchema = {
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
    'totalNoteCount',
    'readiness',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    description: { type: 'string' },
    mode: { type: 'string', enum: ['notebook', 'campaign'] },
    status: { type: 'string', enum: ['active', 'archived'] },
    targetDate: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
    createdAt: { type: 'string', format: 'date-time' },
    modifiedAt: { type: 'string', format: 'date-time' },
    totalNoteCount: { type: 'integer', minimum: 0 },
    readiness: readinessSummarySchema,
  },
}

const heatmapDaySchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'date',
    'totalActions',
    'notesCreated',
    'notesUpdated',
    'postMortemsCreated',
    'flashcardsCreated',
    'flashcardsReviewed',
  ],
  properties: {
    date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    totalActions: { type: 'integer', minimum: 0 },
    notesCreated: { type: 'integer', minimum: 0 },
    notesUpdated: { type: 'integer', minimum: 0 },
    postMortemsCreated: { type: 'integer', minimum: 0 },
    flashcardsCreated: { type: 'integer', minimum: 0 },
    flashcardsReviewed: { type: 'integer', minimum: 0 },
  },
}

const velocityDaySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['date', 'totalActions', 'notesCreated', 'notesUpdated', 'flashcardsReviewed'],
  properties: {
    date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    totalActions: { type: 'integer', minimum: 0 },
    notesCreated: { type: 'integer', minimum: 0 },
    notesUpdated: { type: 'integer', minimum: 0 },
    flashcardsReviewed: { type: 'integer', minimum: 0 },
  },
}

module.exports = async function dashboardRoutes(fastify) {
  fastify.get('/summary', {
    schema: {
      tags: ['dashboard'],
      summary:
        'Read pre-aggregated Home dashboard telemetry, active Campaigns/Notebooks, 12-week heatmap, and 14-day velocity',
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
                'inboxNoteCount',
                'dueFlashcardsCount',
                'activeCampaigns',
                'activeNotebooks',
                'heatmap12Weeks',
                'velocity14Days',
              ],
              properties: {
                inboxNoteCount: { type: 'integer', minimum: 0 },
                dueFlashcardsCount: { type: 'integer', minimum: 0 },
                activeCampaigns: {
                  type: 'array',
                  items: activeContainerSummarySchema,
                },
                activeNotebooks: {
                  type: 'array',
                  items: activeContainerSummarySchema,
                },
                heatmap12Weeks: {
                  type: 'array',
                  minItems: 84,
                  maxItems: 84,
                  items: heatmapDaySchema,
                },
                velocity14Days: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['days', 'totals'],
                  properties: {
                    days: {
                      type: 'array',
                      minItems: 14,
                      maxItems: 14,
                      items: velocityDaySchema,
                    },
                    totals: {
                      type: 'object',
                      additionalProperties: false,
                      required: [
                        'totalActions',
                        'notesCreated',
                        'notesUpdated',
                        'flashcardsReviewed',
                      ],
                      properties: {
                        totalActions: { type: 'integer', minimum: 0 },
                        notesCreated: { type: 'integer', minimum: 0 },
                        notesUpdated: { type: 'integer', minimum: 0 },
                        flashcardsReviewed: { type: 'integer', minimum: 0 },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    handler: async function getDashboardSummaryHandler(request) {
      const userId = request.user._id || request.user.id
      const summary = await fastify.dashboardDataSource.getDashboardSummary(userId)
      return { data: summary }
    },
  })
}
