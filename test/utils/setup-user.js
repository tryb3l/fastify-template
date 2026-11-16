'use strict'

const assert = require('node:assert/strict')
const { randomUUIDv7 } = require('node:crypto')
const { hashPassword } = require('../../routes/auth/generate-hash')
const { buildApp, getTestMongoUrl } = require('../test-setup')
const { randomUsername, randomEmail, randomPassword } = require('./data-creator')

const SEEDED_USER_PASSWORD = 'SeededUserPass!123'
let cachedSeedPasswordHashPromise = null

function getSeededPasswordHash() {
  if (!cachedSeedPasswordHashPromise) {
    cachedSeedPasswordHashPromise = hashPassword(SEEDED_USER_PASSWORD).catch((err) => {
      cachedSeedPasswordHashPromise = null
      throw err
    })
  }
  return cachedSeedPasswordHashPromise
}

// Mode A: Full unmocked HTTP registration + authentication exercising real Argon2id
async function setup(t, role = 'user', env = {}) {
  const app = await buildApp(t, env)
  const mongoUrl = getTestMongoUrl(env)

  const username = randomUsername(12)
  const email = randomEmail(10, 5)
  const password = randomPassword(15)

  const registerResponse = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { username, email, password },
  })
  assert.equal(registerResponse.statusCode, 201)

  if (role !== 'user') {
    await app.mongo.db
      .collection('users')
      .updateOne({ username: username.toLowerCase() }, { $set: { role } })
  }

  const loginResponse = await app.inject({
    method: 'POST',
    url: '/auth/authenticate',
    payload: { username, password },
  })
  assert.equal(loginResponse.statusCode, 200)

  const responseData = loginResponse.json()
  const accessToken = responseData.access_token
  const setCookie = loginResponse.headers['set-cookie'] || []
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie]
  const refreshCookieStr = cookies.find((c) => c && c.startsWith('refreshToken=')) || ''
  const refreshToken = refreshCookieStr.split(';')[0].split('=')[1]
  const userId = responseData.user.id

  return { app, accessToken, refreshToken, userId, username, email, password, mongoUrl }
}

function normalizeSeedUserOptions(optionsOrRole = {}, envArg = {}) {
  if (typeof optionsOrRole === 'string') {
    if (envArg === null || typeof envArg !== 'object' || Array.isArray(envArg)) {
      throw new TypeError('seedUser env override must be a plain object')
    }
    return {
      app: null,
      role: optionsOrRole,
      emailVerified: true,
      username: randomUsername(12),
      email: randomEmail(10, 5),
      env: envArg,
    }
  }

  if (optionsOrRole === null || typeof optionsOrRole !== 'object' || Array.isArray(optionsOrRole)) {
    throw new TypeError('seedUser second argument must be a role string or an options object')
  }

  const {
    app = null,
    role = 'user',
    emailVerified = true,
    username = randomUsername(12),
    email = randomEmail(10, 5),
    env = {},
  } = optionsOrRole

  return { app, role, emailVerified, username, email, env }
}

// Mode B: Fast domain actor seeding using a worker-cached real Argon2id hash,
// public usersDataSource.createUser decorator, and signed production-shape JWTs
async function seedUser(t, optionsOrRole = {}, envArg = {}) {
  const {
    app: providedApp,
    role,
    emailVerified,
    username,
    email,
    env,
  } = normalizeSeedUserOptions(optionsOrRole, envArg)
  const mongoUrl = getTestMongoUrl(env)
  const normalizedUsername = username.trim().toLowerCase()
  const normalizedEmail = email.trim().toLowerCase()
  const [app, hash] = await Promise.all([
    providedApp ? Promise.resolve(providedApp) : buildApp(t, env),
    getSeededPasswordHash(),
  ])

  const userId = await app.usersDataSource.createUser({
    username: normalizedUsername,
    email: normalizedEmail,
    emailVerified,
    hash,
    role,
  })

  const jwtPayload = {
    sub: userId,
    username: normalizedUsername,
    role,
    cv: 0,
  }

  const accessToken = app.jwt.sign(
    { ...jwtPayload, type: 'access' },
    {
      jti: randomUUIDv7(),
      expiresIn: app.config.jwt.accessExpireIn || '1h',
    },
  )

  const refreshToken = app.jwt.sign(
    { ...jwtPayload, type: 'refresh' },
    {
      jti: randomUUIDv7(),
      expiresIn: app.config.jwt.refreshExpireIn || '30d',
    },
  )

  return {
    app,
    accessToken,
    refreshToken,
    userId,
    username: normalizedUsername,
    email: normalizedEmail,
    password: SEEDED_USER_PASSWORD,
    mongoUrl,
  }
}

module.exports = {
  SEEDED_USER_PASSWORD,
  normalizeSeedUserOptions,
  seedUser,
  setup,
  setupHttpUser: setup,
}
