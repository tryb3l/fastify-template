'use strict'

const FLASHCARD_CONSTRAINTS = Object.freeze({
  FRONT_MIN_LENGTH: 1,
  FRONT_MAX_LENGTH: 2_000,
  BACK_MIN_LENGTH: 1,
  BACK_MAX_LENGTH: 5_000,
  BOX_MIN: 1,
  BOX_MAX: 5,
  DRILL_LIMIT_DEFAULT: 50,
  DRILL_LIMIT_MAX: 200,
})

const FLASHCARD_RATINGS = Object.freeze(['again', 'hard', 'good'])
const FLASHCARD_DRILL_MODES = Object.freeze(['scheduled', 'cram_all'])
const FLASHCARD_DRILL_ORDERS = Object.freeze(['weakest_first', 'sequential', 'shuffled'])
const LEITNER_BOX_INTERVAL_DAYS = Object.freeze({
  1: 1,
  2: 3,
  3: 7,
  4: 14,
  5: 30,
})

function buildFlashcardSchemas() {
  const flashcardSchema = {
    type: 'object',
    $id: 'schema:flashcard',
    additionalProperties: false,
    required: [
      'id',
      'noteId',
      'front',
      'back',
      'box',
      'nextReviewAt',
      'lastReviewedAt',
      'reviewCount',
      'lapseCount',
      'lastRating',
      'createdAt',
      'modifiedAt',
    ],
    properties: {
      id: { type: 'string', format: 'uuid' },
      noteId: { type: 'string', format: 'uuid' },
      front: {
        type: 'string',
        minLength: FLASHCARD_CONSTRAINTS.FRONT_MIN_LENGTH,
        maxLength: FLASHCARD_CONSTRAINTS.FRONT_MAX_LENGTH,
      },
      back: {
        type: 'string',
        minLength: FLASHCARD_CONSTRAINTS.BACK_MIN_LENGTH,
        maxLength: FLASHCARD_CONSTRAINTS.BACK_MAX_LENGTH,
      },
      box: {
        type: 'integer',
        minimum: FLASHCARD_CONSTRAINTS.BOX_MIN,
        maximum: FLASHCARD_CONSTRAINTS.BOX_MAX,
      },
      nextReviewAt: { type: 'string', format: 'date-time' },
      lastReviewedAt: { type: ['string', 'null'], format: 'date-time' },
      reviewCount: { type: 'integer', minimum: 0 },
      lapseCount: { type: 'integer', minimum: 0 },
      lastRating: { type: ['string', 'null'], enum: [...FLASHCARD_RATINGS, null] },
      createdAt: { type: 'string', format: 'date-time' },
      modifiedAt: { type: 'string', format: 'date-time' },
    },
  }

  const drillFlashcardSchema = {
    type: 'object',
    $id: 'schema:flashcard:drill:item',
    additionalProperties: false,
    required: [
      'id',
      'noteId',
      'noteTitle',
      'noteReadiness',
      'isExternal',
      'homeNotebookId',
      'front',
      'back',
      'box',
      'nextReviewAt',
      'lastReviewedAt',
      'reviewCount',
      'lapseCount',
      'lastRating',
      'createdAt',
      'modifiedAt',
    ],
    properties: {
      ...flashcardSchema.properties,
      noteTitle: { type: 'string' },
      noteReadiness: { type: 'string', enum: ['to_review', 'in_progress', 'mastered'] },
      isExternal: { type: 'boolean' },
      homeNotebookId: { type: ['string', 'null'], format: 'uuid' },
    },
  }

  return [
    flashcardSchema,
    drillFlashcardSchema,
    {
      type: 'object',
      $id: 'schema:flashcard:create:body',
      additionalProperties: false,
      required: ['noteId', 'front', 'back'],
      properties: {
        noteId: { type: 'string', format: 'uuid' },
        front: {
          type: 'string',
          minLength: FLASHCARD_CONSTRAINTS.FRONT_MIN_LENGTH,
          maxLength: FLASHCARD_CONSTRAINTS.FRONT_MAX_LENGTH,
        },
        back: {
          type: 'string',
          minLength: FLASHCARD_CONSTRAINTS.BACK_MIN_LENGTH,
          maxLength: FLASHCARD_CONSTRAINTS.BACK_MAX_LENGTH,
        },
      },
    },
    {
      type: 'object',
      $id: 'schema:flashcard:update:body',
      additionalProperties: false,
      minProperties: 1,
      properties: {
        front: {
          type: 'string',
          minLength: FLASHCARD_CONSTRAINTS.FRONT_MIN_LENGTH,
          maxLength: FLASHCARD_CONSTRAINTS.FRONT_MAX_LENGTH,
        },
        back: {
          type: 'string',
          minLength: FLASHCARD_CONSTRAINTS.BACK_MIN_LENGTH,
          maxLength: FLASHCARD_CONSTRAINTS.BACK_MAX_LENGTH,
        },
      },
    },
    {
      type: 'object',
      $id: 'schema:flashcard:review:body',
      additionalProperties: false,
      required: ['rating'],
      properties: {
        rating: { type: 'string', enum: [...FLASHCARD_RATINGS] },
      },
    },
    {
      type: 'object',
      $id: 'schema:flashcard:drill:query',
      additionalProperties: false,
      properties: {
        notebookId: { type: 'string', format: 'uuid' },
        folderId: { type: 'string', format: 'uuid' },
        noteId: { type: 'string', format: 'uuid' },
        includeExternal: { type: 'boolean', default: true },
        mode: {
          type: 'string',
          enum: [...FLASHCARD_DRILL_MODES],
          default: 'scheduled',
        },
        order: {
          type: 'string',
          enum: [...FLASHCARD_DRILL_ORDERS],
          default: 'weakest_first',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: FLASHCARD_CONSTRAINTS.DRILL_LIMIT_MAX,
          default: FLASHCARD_CONSTRAINTS.DRILL_LIMIT_DEFAULT,
        },
      },
    },
  ]
}

module.exports = {
  FLASHCARD_CONSTRAINTS,
  FLASHCARD_DRILL_MODES,
  FLASHCARD_DRILL_ORDERS,
  FLASHCARD_RATINGS,
  LEITNER_BOX_INTERVAL_DAYS,
  buildFlashcardSchemas,
}
