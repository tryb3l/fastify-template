'use strict'

const { USER_CONSTRAINTS } = require('../users/user-contract')

function buildAuthSchemas() {
  return [
    {
      $id: 'schema:auth:password-policy',
      type: 'string',
      minLength: USER_CONSTRAINTS.PASSWORD_MIN_LENGTH,
      maxLength: USER_CONSTRAINTS.PASSWORD_MAX_LENGTH,
      pattern: USER_CONSTRAINTS.PASSWORD_PATTERN,
      description: 'At least one lowercase, uppercase, digit and special character',
    },
    {
      $id: 'schema:auth:register',
      type: 'object',
      required: ['username', 'email', 'password'],
      additionalProperties: false,
      properties: {
        username: {
          type: 'string',
          minLength: USER_CONSTRAINTS.USERNAME_MIN_LENGTH,
          maxLength: USER_CONSTRAINTS.USERNAME_MAX_LENGTH,
          description: 'Unique username',
        },
        email: {
          type: 'string',
          format: 'email',
          description: 'Valid email address',
        },
        password: {
          $ref: 'schema:auth:password-policy',
        },
        inviteToken: {
          type: 'string',
          minLength: 10,
          maxLength: 256,
          description: 'Single-use invitation token (<inviteId>.<secret>)',
        },
      },
    },
    {
      $id: 'schema:auth:authenticate',
      type: 'object',
      required: ['password'],
      anyOf: [{ required: ['username'] }, { required: ['email'] }],
      additionalProperties: false,
      properties: {
        username: {
          type: 'string',
          minLength: USER_CONSTRAINTS.USERNAME_MIN_LENGTH,
          maxLength: 255,
          description: "The user's username (or email address if entered in this field)",
        },
        email: {
          type: 'string',
          format: 'email',
          description: "The user's email address",
        },
        password: {
          type: 'string',
          minLength: USER_CONSTRAINTS.PASSWORD_MIN_LENGTH,
          maxLength: USER_CONSTRAINTS.PASSWORD_MAX_LENGTH,
        },
      },
    },
    {
      $id: 'schema:auth:reset-request',
      type: 'object',
      required: ['email'],
      additionalProperties: false,
      properties: {
        email: {
          type: 'string',
          format: 'email',
        },
      },
    },
    {
      $id: 'schema:auth:reset-validate',
      type: 'object',
      required: ['resetId', 'secret'],
      additionalProperties: false,
      properties: {
        resetId: {
          type: 'string',
          format: 'uuid',
        },
        secret: {
          type: 'string',
          minLength: 32,
        },
      },
    },
    {
      $id: 'schema:auth:reset-confirm',
      type: 'object',
      required: ['resetId', 'secret', 'newPassword'],
      additionalProperties: false,
      properties: {
        resetId: {
          type: 'string',
          format: 'uuid',
        },
        secret: {
          type: 'string',
          minLength: 32,
        },
        newPassword: {
          $ref: 'schema:auth:password-policy',
        },
      },
    },
    {
      $id: 'schema:auth:verify-email:request',
      type: 'object',
      additionalProperties: false,
      properties: {
        email: {
          type: 'string',
          format: 'email',
        },
      },
    },
    {
      $id: 'schema:auth:verify-email:confirm',
      type: 'object',
      required: ['token'],
      additionalProperties: false,
      properties: {
        email: {
          type: 'string',
          format: 'email',
        },
        token: {
          type: 'string',
          minLength: 10,
          maxLength: 256,
        },
      },
    },
  ]
}

module.exports = {
  buildAuthSchemas,
}
