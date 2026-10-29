'use strict'

const NOTE_CONSTRAINTS = Object.freeze({
  TITLE_MIN_LENGTH: 1,
  TITLE_MAX_LENGTH: 100,
  BODY_MIN_LENGTH: 0,
  BODY_MAX_LENGTH: 50_000,
  TAG_MIN_LENGTH: 1,
  TAG_MAX_LENGTH: 10,
  TAGS_MAX_ITEMS: 50,
  LINKS_MAX_ITEMS: 100,
  LINK_LABEL_MIN_LENGTH: 1,
  LINK_LABEL_MAX_LENGTH: 100,
  ATTACHMENTS_MAX_ITEMS: 10,
  ATTACHMENT_FILENAME_MAX_LENGTH: 255,
  ATTACHMENT_MIMETYPE_MAX_LENGTH: 127,
  LIST_LIMIT_DEFAULT: 10,
  LIST_LIMIT_MAX: 100,
  LIST_SKIP_MAX: 100,
})

const NOTE_LINK_RELATIONS = Object.freeze(['parent', 'child', 'related'])

const CSV_IMPORTABLE_HEADERS = Object.freeze(['title', 'body', 'tags'])
const CSV_IGNORED_HEADERS = Object.freeze(['createdAt', 'modifiedAt', 'id'])
const CSV_REQUIRED_HEADERS = Object.freeze(['title', 'body'])
const CSV_EXPORT_COLUMNS = Object.freeze(['title', 'body', 'tags', 'createdAt', 'modifiedAt', 'id'])

const NOTE_DETAIL_FIELDS = Object.freeze([
  'id',
  'title',
  'body',
  'tags',
  'notebookId',
  'folderId',
  'links',
  'attachments',
  'revision',
  'createdAt',
  'modifiedAt',
])

const NOTE_LIST_FIELDS = Object.freeze([
  'id',
  'title',
  'tags',
  'notebookId',
  'folderId',
  'revision',
  'createdAt',
  'modifiedAt',
])

const NOTE_GRAPH_NODE_FIELDS = Object.freeze([
  'id',
  'title',
  'tags',
  'notebookId',
  'folderId',
  'links',
  'modifiedAt',
])

function buildProjection(fields, includeExcludeId = false) {
  const projection = includeExcludeId ? { _id: 0 } : {}
  for (const field of fields) {
    projection[field] = 1
  }
  return Object.freeze(projection)
}

const NOTE_DETAIL_PROJECTION = buildProjection(NOTE_DETAIL_FIELDS, true)
const NOTE_LIST_PROJECTION = buildProjection(NOTE_LIST_FIELDS, false)
const NOTE_GRAPH_NODE_PROJECTION = buildProjection(NOTE_GRAPH_NODE_FIELDS, true)
const NOTE_EXPORT_PROJECTION = buildProjection(CSV_EXPORT_COLUMNS, false)

function buildNoteSchemas() {
  const tagItemSchema = {
    type: 'string',
    minLength: NOTE_CONSTRAINTS.TAG_MIN_LENGTH,
    maxLength: NOTE_CONSTRAINTS.TAG_MAX_LENGTH,
  }

  const persistedLinkItemSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['targetId', 'relation'],
    properties: {
      targetId: { type: 'string', format: 'uuid' },
      relation: { type: 'string', enum: [...NOTE_LINK_RELATIONS] },
      label: {
        type: 'string',
        minLength: NOTE_CONSTRAINTS.LINK_LABEL_MIN_LENGTH,
        maxLength: NOTE_CONSTRAINTS.LINK_LABEL_MAX_LENGTH,
      },
    },
  }

  const inputLinkItemSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['targetId'],
    properties: {
      targetId: { type: 'string', format: 'uuid' },
      relation: {
        type: 'string',
        enum: [...NOTE_LINK_RELATIONS],
        default: 'related',
      },
      label: {
        type: 'string',
        minLength: NOTE_CONSTRAINTS.LINK_LABEL_MIN_LENGTH,
        maxLength: NOTE_CONSTRAINTS.LINK_LABEL_MAX_LENGTH,
      },
    },
  }

  return [
    {
      type: 'object',
      $id: 'schema:note',
      additionalProperties: false,
      required: ['revision'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        revision: { type: 'integer', minimum: 1 },
        title: {
          type: 'string',
          minLength: NOTE_CONSTRAINTS.TITLE_MIN_LENGTH,
          maxLength: NOTE_CONSTRAINTS.TITLE_MAX_LENGTH,
        },
        body: {
          type: 'string',
          minLength: NOTE_CONSTRAINTS.BODY_MIN_LENGTH,
          maxLength: NOTE_CONSTRAINTS.BODY_MAX_LENGTH,
        },
        tags: {
          type: 'array',
          items: tagItemSchema,
          maxItems: NOTE_CONSTRAINTS.TAGS_MAX_ITEMS,
        },
        notebookId: { type: ['string', 'null'], format: 'uuid' },
        folderId: { type: ['string', 'null'], format: 'uuid' },
        links: {
          type: 'array',
          maxItems: NOTE_CONSTRAINTS.LINKS_MAX_ITEMS,
          items: persistedLinkItemSchema,
        },
        attachments: {
          type: 'array',
          maxItems: NOTE_CONSTRAINTS.ATTACHMENTS_MAX_ITEMS,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['fileId', 'originalFilename', 'mimeType', 'size', 'uploadedAt'],
            properties: {
              fileId: { type: 'string', format: 'uuid' },
              originalFilename: {
                type: 'string',
                minLength: 1,
                maxLength: NOTE_CONSTRAINTS.ATTACHMENT_FILENAME_MAX_LENGTH,
              },
              mimeType: {
                type: 'string',
                minLength: 1,
                maxLength: NOTE_CONSTRAINTS.ATTACHMENT_MIMETYPE_MAX_LENGTH,
              },
              size: { type: 'integer', minimum: 0 },
              uploadedAt: { type: 'string', format: 'date-time' },
            },
          },
        },
        createdAt: { type: 'string', format: 'date-time' },
        modifiedAt: { type: 'string', format: 'date-time' },
      },
    },
    {
      type: 'object',
      $id: 'schema:note:list:item',
      additionalProperties: false,
      required: ['revision'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        revision: { type: 'integer', minimum: 1 },
        title: {
          type: 'string',
          minLength: NOTE_CONSTRAINTS.TITLE_MIN_LENGTH,
          maxLength: NOTE_CONSTRAINTS.TITLE_MAX_LENGTH,
        },
        tags: {
          type: 'array',
          items: tagItemSchema,
          maxItems: NOTE_CONSTRAINTS.TAGS_MAX_ITEMS,
        },
        notebookId: { type: ['string', 'null'], format: 'uuid' },
        folderId: { type: ['string', 'null'], format: 'uuid' },
        createdAt: { type: 'string', format: 'date-time' },
        modifiedAt: { type: 'string', format: 'date-time' },
      },
    },
    {
      type: 'object',
      $id: 'schema:note:list:response',
      additionalProperties: false,
      properties: {
        data: {
          type: 'array',
          items: { $ref: 'schema:note:list:item#' },
        },
        totalCount: { type: 'integer' },
      },
    },
    {
      type: 'object',
      $id: 'schema:note:list:query',
      additionalProperties: false,
      properties: {
        title: { type: 'string' },
        notebookId: { type: 'string', format: 'uuid' },
        folderId: { type: 'string', format: 'uuid' },
        inbox: { type: 'boolean' },
        limit: {
          type: 'integer',
          default: NOTE_CONSTRAINTS.LIST_LIMIT_DEFAULT,
          minimum: 1,
          maximum: NOTE_CONSTRAINTS.LIST_LIMIT_MAX,
        },
        skip: {
          type: 'integer',
          default: 0,
          minimum: 0,
          maximum: NOTE_CONSTRAINTS.LIST_SKIP_MAX,
        },
      },
    },
    {
      $id: 'schema:note:list:export',
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string' },
        notebookId: { type: 'string', format: 'uuid' },
        folderId: { type: 'string', format: 'uuid' },
        inbox: { type: 'boolean' },
        notes: {
          type: 'array',
          items: { $ref: 'schema:note#' },
        },
      },
    },
    {
      type: 'object',
      $id: 'schema:note:create:body',
      required: ['title'],
      additionalProperties: false,
      properties: {
        title: {
          type: 'string',
          minLength: NOTE_CONSTRAINTS.TITLE_MIN_LENGTH,
          maxLength: NOTE_CONSTRAINTS.TITLE_MAX_LENGTH,
        },
        body: {
          type: 'string',
          maxLength: NOTE_CONSTRAINTS.BODY_MAX_LENGTH,
        },
        tags: {
          type: 'array',
          items: tagItemSchema,
        },
        notebookId: { type: ['string', 'null'], format: 'uuid' },
        folderId: { type: ['string', 'null'], format: 'uuid' },
        links: {
          type: 'array',
          maxItems: NOTE_CONSTRAINTS.LINKS_MAX_ITEMS,
          items: inputLinkItemSchema,
        },
      },
    },
    {
      type: 'object',
      $id: 'schema:note:create:response',
      required: ['id'],
      additionalProperties: false,
      properties: {
        id: { type: 'string', format: 'uuid' },
      },
    },
    {
      type: 'object',
      $id: 'schema:note:update:body',
      additionalProperties: false,
      required: ['expectedRevision'],
      properties: {
        title: {
          type: 'string',
          minLength: NOTE_CONSTRAINTS.TITLE_MIN_LENGTH,
          maxLength: NOTE_CONSTRAINTS.TITLE_MAX_LENGTH,
        },
        body: {
          type: 'string',
          maxLength: NOTE_CONSTRAINTS.BODY_MAX_LENGTH,
        },
        tags: {
          type: 'array',
          items: tagItemSchema,
        },
        notebookId: { type: ['string', 'null'], format: 'uuid' },
        folderId: { type: ['string', 'null'], format: 'uuid' },
        links: {
          type: 'array',
          maxItems: NOTE_CONSTRAINTS.LINKS_MAX_ITEMS,
          items: inputLinkItemSchema,
        },
        expectedRevision: { type: 'integer', minimum: 1 },
      },
    },
    {
      type: 'object',
      $id: 'schema:note:read:params',
      required: ['id'],
      additionalProperties: false,
      properties: {
        id: { type: 'string', format: 'uuid' },
      },
    },
    {
      type: 'object',
      $id: 'schema:note:delete:query',
      additionalProperties: false,
      required: ['expectedRevision'],
      properties: {
        expectedRevision: { type: 'integer', minimum: 1 },
      },
    },
  ]
}

module.exports = {
  CSV_EXPORT_COLUMNS,
  CSV_IGNORED_HEADERS,
  CSV_IMPORTABLE_HEADERS,
  CSV_REQUIRED_HEADERS,
  NOTE_CONSTRAINTS,
  NOTE_DETAIL_PROJECTION,
  NOTE_EXPORT_PROJECTION,
  NOTE_GRAPH_NODE_PROJECTION,
  NOTE_LINK_RELATIONS,
  NOTE_LIST_PROJECTION,
  buildNoteSchemas,
}
