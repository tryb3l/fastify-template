'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { buildApp, getTestMongoUrl } = require('../../../test-setup')
const { randomUsername, randomEmail, randomPassword } = require('../../../utils/data-creator')

function replaceDatabaseName(mongoUrl, databaseName) {
  return mongoUrl.replace(/\/[^/?]+(?=$|\?)/, `/${databaseName}`)
}

async function buildRegisterApp(t) {
  return buildApp(t, {
    MONGO_URL: replaceDatabaseName(getTestMongoUrl(), 'login-test-db'),
  })
}

async function registerUser(app, payload) {
  return app.inject({
    method: 'POST',
    url: '/auth/register',
    payload,
  })
}

test('POST /auth/register 201 - register the user successfully', async (t) => {
  // Arrange
  const app = await buildRegisterApp(t)

  const payload = {
    username: randomUsername(),
    email: randomEmail(),
    password: randomPassword(),
  }

  // Act
  const response = await registerUser(app, payload)

  // Assert
  assert.strictEqual(response.statusCode, 201)
  assert.deepStrictEqual(response.json(), { registered: true })
})

test('POST /auth/register 409 - conflict on existing user', async (t) => {
  // Arrange
  const app = await buildRegisterApp(t)

  const payload = {
    username: randomUsername(),
    email: randomEmail(),
    password: randomPassword(),
  }

  const existingUserResponse = await registerUser(app, payload)
  assert.strictEqual(existingUserResponse.statusCode, 201)

  // Act
  const response = await registerUser(app, payload)

  // Assert
  assert.strictEqual(response.statusCode, 409)
  assert.ok(response.json().message.includes('User already registered'))
})

test('POST /auth/register 400 - failed signup, invalid email format', async (t) => {
  // Arrange
  const app = await buildRegisterApp(t)

  const payload = {
    username: randomUsername(),
    password: randomPassword(),
    email: 'fake#email.com',
  }

  // Act
  const response = await registerUser(app, payload)

  // Assert
  assert.strictEqual(response.statusCode, 400)
  assert.ok(response.json().message)
})

test('POST /auth/register 400 - failed signup, missing required field (password)', async (t) => {
  // Arrange
  const app = await buildRegisterApp(t)

  const payload = {
    username: randomUsername(),
    email: randomEmail(),
    // Missing password
  }

  // Act
  const response = await registerUser(app, payload)

  // Assert
  assert.strictEqual(response.statusCode, 400)
  assert.ok(response.json().message)
})

test('POST /auth/register 400 - failed signup, weak password policy violation', async (t) => {
  // Arrange
  const app = await buildRegisterApp(t)

  const payload = {
    username: randomUsername(),
    email: randomEmail(),
    password: 'weakpass',
  }

  // Act
  const response = await registerUser(app, payload)

  // Assert
  assert.strictEqual(response.statusCode, 400)
  assert.ok(response.json().message)
})
