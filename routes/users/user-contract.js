'use strict'

const USER_CONSTRAINTS = Object.freeze({
  USERNAME_MIN_LENGTH: 3,
  USERNAME_MAX_LENGTH: 32,
  NAME_MIN_LENGTH: 1,
  NAME_MAX_LENGTH: 64,
  PASSWORD_MIN_LENGTH: 8,
  PASSWORD_MAX_LENGTH: 64,
  PASSWORD_PATTERN: '^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[^A-Za-z0-9]).{8,64}$',
  LIST_LIMIT_DEFAULT: 10,
  LIST_LIMIT_MAX: 100,
})

const USER_ROLES = Object.freeze(['user', 'admin'])

const USER_DETAIL_FIELDS = Object.freeze([
  '_id',
  'id',
  'username',
  'email',
  'emailVerified',
  'firstName',
  'lastName',
  'role',
  'createdAt',
  'modifiedAt',
])

const USER_AUTH_SESSION_FIELDS = Object.freeze([
  '_id',
  'id',
  'username',
  'email',
  'emailVerified',
  'role',
  'credentialsVersion',
])

const USER_AUTH_WITH_HASH_FIELDS = Object.freeze([
  '_id',
  'id',
  'username',
  'email',
  'emailVerified',
  'role',
  'hash',
  'password',
  'deleted',
  'createdAt',
  'modifiedAt',
  'credentialsVersion',
])

function buildProjection(fields) {
  const projection = {}
  for (const field of fields) {
    projection[field] = 1
  }
  return Object.freeze(projection)
}

const USER_DETAIL_PROJECTION = buildProjection(USER_DETAIL_FIELDS)
const USER_AUTH_SESSION_PROJECTION = buildProjection(USER_AUTH_SESSION_FIELDS)
const USER_AUTH_WITH_HASH_PROJECTION = buildProjection(USER_AUTH_WITH_HASH_FIELDS)

const SELF_UPDATEABLE_USER_FIELDS = Object.freeze(
  new Set(['username', 'email', 'firstName', 'lastName']),
)
const ADMIN_UPDATEABLE_USER_FIELDS = Object.freeze(
  new Set([...SELF_UPDATEABLE_USER_FIELDS, 'role']),
)

const userBaseProperties = {
  username: {
    type: 'string',
    minLength: USER_CONSTRAINTS.USERNAME_MIN_LENGTH,
    maxLength: USER_CONSTRAINTS.USERNAME_MAX_LENGTH,
  },
  email: {
    type: 'string',
    format: 'email',
  },
  firstName: {
    type: 'string',
    minLength: USER_CONSTRAINTS.NAME_MIN_LENGTH,
    maxLength: USER_CONSTRAINTS.NAME_MAX_LENGTH,
  },
  lastName: {
    type: 'string',
    minLength: USER_CONSTRAINTS.NAME_MIN_LENGTH,
    maxLength: USER_CONSTRAINTS.NAME_MAX_LENGTH,
  },
}

function buildUserSchemas() {
  return [
    {
      $id: 'schema:user',
      type: 'object',
      additionalProperties: false,
      properties: {
        id: {
          type: 'string',
          format: 'uuid',
          readOnly: true,
        },
        createdAt: {
          type: 'string',
          format: 'date-time',
          readOnly: true,
        },
        modifiedAt: {
          type: 'string',
          format: 'date-time',
          readOnly: true,
        },
        ...userBaseProperties,
        emailVerified: {
          type: 'boolean',
          readOnly: true,
        },
        role: {
          type: 'string',
          enum: [...USER_ROLES],
        },
      },
    },
    {
      $id: 'schema:user:read:params',
      type: 'object',
      required: ['id'],
      additionalProperties: false,
      properties: {
        id: { type: 'string', format: 'uuid' },
      },
    },
    {
      $id: 'schema:user:update:body',
      type: 'object',
      additionalProperties: false,
      properties: {
        ...userBaseProperties,
      },
    },
    {
      $id: 'schema:user:update:admin:body',
      type: 'object',
      additionalProperties: false,
      properties: {
        ...userBaseProperties,
        role: {
          type: 'string',
          enum: [...USER_ROLES],
        },
      },
    },
    {
      $id: 'schema:user:list:query',
      type: 'object',
      additionalProperties: false,
      properties: {
        skip: {
          type: 'integer',
          minimum: 0,
          default: 0,
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: USER_CONSTRAINTS.LIST_LIMIT_MAX,
          default: USER_CONSTRAINTS.LIST_LIMIT_DEFAULT,
        },
        username: {
          type: 'string',
        },
      },
    },
    {
      $id: 'schema:user:list:response',
      type: 'object',
      additionalProperties: false,
      properties: {
        data: {
          type: 'array',
          items: { $ref: 'schema:user#' },
        },
        totalCount: {
          type: 'integer',
        },
      },
    },
    {
      $id: 'schema:user:invite:create:body',
      type: 'object',
      additionalProperties: false,
      properties: {
        email: {
          type: 'string',
          format: 'email',
        },
        role: {
          type: 'string',
          enum: [...USER_ROLES],
          default: 'user',
        },
        ttlHours: {
          type: 'integer',
          minimum: 1,
          maximum: 8760,
        },
      },
    },
    {
      $id: 'schema:user:invite',
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', format: 'uuid' },
        inviteToken: { type: 'string' },
        email: { type: ['string', 'null'], format: 'email' },
        role: { type: 'string', enum: [...USER_ROLES] },
        createdBy: { type: 'string', format: 'uuid' },
        createdAt: { type: 'string', format: 'date-time' },
        expiresAt: { type: 'string', format: 'date-time' },
        consumedAt: { type: ['string', 'null'], format: 'date-time' },
        consumedBy: { type: ['string', 'null'], format: 'uuid' },
      },
    },
  ]
}

module.exports = {
  ADMIN_UPDATEABLE_USER_FIELDS,
  SELF_UPDATEABLE_USER_FIELDS,
  USER_AUTH_SESSION_PROJECTION,
  USER_AUTH_WITH_HASH_PROJECTION,
  USER_CONSTRAINTS,
  USER_DETAIL_PROJECTION,
  USER_ROLES,
  buildUserSchemas,
}
