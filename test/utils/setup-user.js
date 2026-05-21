'use strict'

const assert = require('node:assert')
const { MongoClient } = require('mongodb')
const { buildApp, getTestMongoUrl } = require('../test-setup')
const { randomUsername, randomEmail, randomPassword } = require('./data-creator')

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
  assert.strictEqual(registerResponse.statusCode, 201)

  if (role !== 'user') {
    const client = new MongoClient(mongoUrl)
    await client.connect()

    try {
      const db = client.db()
      await db.collection('users').updateOne({ username: username }, { $set: { role: role } })
    } finally {
      await client.close()
    }
  }

  const loginResponse = await app.inject({
    method: 'POST',
    url: '/auth/authenticate',
    payload: { username, password },
  })
  assert.strictEqual(loginResponse.statusCode, 200)

  const responseData = loginResponse.json()
  const accessToken = responseData.access_token
  const setCookie = loginResponse.headers['set-cookie'] || []
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie]
  const refreshCookieStr = cookies.find((c) => c && c.startsWith('refreshToken=')) || ''
  const refreshToken = refreshCookieStr.split(';')[0].split('=')[1]
  const userId = responseData.user.id

  return { app, accessToken, refreshToken, userId, username, email, password, mongoUrl }
}

module.exports = { setup }
