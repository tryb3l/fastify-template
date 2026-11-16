'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')

const { buildAuthSchemas } = require('../../routes/auth/auth-contract')
const {
  ADMIN_UPDATEABLE_USER_FIELDS,
  SELF_UPDATEABLE_USER_FIELDS,
  USER_AUTH_SESSION_PROJECTION,
  USER_AUTH_WITH_HASH_PROJECTION,
  USER_CONSTRAINTS,
  USER_DETAIL_PROJECTION,
  USER_ROLES,
  buildUserSchemas,
} = require('../../routes/users/user-contract')
const {
  NOTE_CONSTRAINTS,
  NOTE_DETAIL_PROJECTION,
  NOTE_EXPORT_PROJECTION,
  NOTE_GRAPH_NODE_PROJECTION,
  NOTE_LINK_RELATIONS,
  NOTE_LIST_PROJECTION,
  NOTE_READINESS_VALUES,
  NOTE_TYPES,
  buildNoteSchemas,
} = require('../../routes/notes/note-contract')
const {
  FLASHCARD_CONSTRAINTS,
  FLASHCARD_DRILL_MODES,
  FLASHCARD_DRILL_ORDERS,
  FLASHCARD_RATINGS,
  LEITNER_BOX_INTERVAL_DAYS,
  buildFlashcardSchemas,
} = require('../../routes/flashcards/flashcard-contract')

describe('domain schema and projection contracts', () => {
  test('auth-contract builds expected auth schemas referencing shared user constraints', () => {
    // Arrange & Act
    const schemas = buildAuthSchemas()
    const byId = new Map(schemas.map((s) => [s.$id, s]))

    // Assert
    assert.deepEqual(
      schemas.map((s) => s.$id),
      [
        'schema:auth:password-policy',
        'schema:auth:register',
        'schema:auth:authenticate',
        'schema:auth:reset-request',
        'schema:auth:reset-validate',
        'schema:auth:reset-confirm',
        'schema:auth:verify-email:request',
        'schema:auth:verify-email:confirm',
      ],
    )
    const passwordPolicy = byId.get('schema:auth:password-policy')
    assert.equal(passwordPolicy.minLength, USER_CONSTRAINTS.PASSWORD_MIN_LENGTH)
    assert.equal(passwordPolicy.maxLength, USER_CONSTRAINTS.PASSWORD_MAX_LENGTH)
    assert.equal(byId.get('schema:auth:register').additionalProperties, false)
    assert.deepEqual(byId.get('schema:auth:register').required, ['username', 'email', 'password'])
  })

  test('user-contract enforces safe projections, role bounds, and self vs admin update fields', () => {
    // Arrange & Act
    const schemas = buildUserSchemas()
    const schemaIds = schemas.map((s) => s.$id)

    // Assert
    assert.ok(Object.isFrozen(USER_DETAIL_PROJECTION))
    assert.ok(Object.isFrozen(USER_AUTH_SESSION_PROJECTION))
    assert.ok(Object.isFrozen(USER_AUTH_WITH_HASH_PROJECTION))
    assert.equal(USER_DETAIL_PROJECTION.hash, undefined)
    assert.equal(USER_AUTH_SESSION_PROJECTION.hash, undefined)
    assert.equal(USER_AUTH_WITH_HASH_PROJECTION.hash, 1)
    assert.equal(SELF_UPDATEABLE_USER_FIELDS.has('role'), false)
    assert.equal(ADMIN_UPDATEABLE_USER_FIELDS.has('role'), true)
    assert.deepEqual([...USER_ROLES], ['user', 'admin'])
    assert.ok(schemaIds.includes('schema:user'))
    assert.ok(schemaIds.includes('schema:user:update:body'))
    assert.ok(schemaIds.includes('schema:user:update:admin:body'))
  })

  test('note-contract exposes frozen projections and bounded note schemas', () => {
    // Arrange & Act
    const schemas = buildNoteSchemas()
    const byId = new Map(schemas.map((s) => [s.$id, s]))

    // Assert
    assert.ok(Object.isFrozen(NOTE_DETAIL_PROJECTION))
    assert.ok(Object.isFrozen(NOTE_LIST_PROJECTION))
    assert.ok(Object.isFrozen(NOTE_GRAPH_NODE_PROJECTION))
    assert.ok(Object.isFrozen(NOTE_EXPORT_PROJECTION))
    assert.equal(NOTE_DETAIL_PROJECTION._id, 0)
    assert.equal(NOTE_DETAIL_PROJECTION.body, 1)
    assert.equal(NOTE_LIST_PROJECTION.body, undefined)
    assert.deepEqual([...NOTE_LINK_RELATIONS], ['parent', 'child', 'related'])
    assert.deepEqual([...NOTE_READINESS_VALUES], ['to_review', 'in_progress', 'mastered'])
    assert.deepEqual([...NOTE_TYPES], ['standard', 'post_mortem'])

    const noteSchema = byId.get('schema:note')
    assert.equal(noteSchema.properties.body.maxLength, NOTE_CONSTRAINTS.BODY_MAX_LENGTH)
    assert.equal(noteSchema.properties.title.maxLength, NOTE_CONSTRAINTS.TITLE_MAX_LENGTH)
    assert.ok(byId.has('schema:note:list:query'))
    assert.ok(byId.has('schema:note:create:body'))
    assert.ok(byId.has('schema:note:update:body'))
    assert.ok(byId.has('schema:note:delete:query'))
  })

  test('flashcard-contract defines Leitner box bounds, intervals, and drill query defaults', () => {
    // Arrange & Act
    const schemas = buildFlashcardSchemas()
    const byId = new Map(schemas.map((s) => [s.$id, s]))
    const flashcardSchema = byId.get('schema:flashcard')
    const drillQuery = byId.get('schema:flashcard:drill:query')

    // Assert
    assert.equal(FLASHCARD_CONSTRAINTS.BOX_MIN, 1)
    assert.equal(FLASHCARD_CONSTRAINTS.BOX_MAX, 5)
    assert.deepEqual([...FLASHCARD_RATINGS], ['again', 'hard', 'good'])
    assert.deepEqual([...FLASHCARD_DRILL_MODES], ['scheduled', 'cram_all'])
    assert.deepEqual([...FLASHCARD_DRILL_ORDERS], ['weakest_first', 'sequential', 'shuffled'])
    assert.deepEqual(LEITNER_BOX_INTERVAL_DAYS, { 1: 1, 2: 3, 3: 7, 4: 14, 5: 30 })
    assert.equal(flashcardSchema.properties.box.minimum, 1)
    assert.equal(flashcardSchema.properties.box.maximum, 5)
    assert.equal(drillQuery.properties.mode.default, 'scheduled')
    assert.equal(drillQuery.properties.order.default, 'weakest_first')
    assert.equal(drillQuery.properties.includeExternal.default, true)
    assert.equal(drillQuery.properties.limit.default, FLASHCARD_CONSTRAINTS.DRILL_LIMIT_DEFAULT)
  })
})
