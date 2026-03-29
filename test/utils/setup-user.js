'use strict'

const assert = require('node:assert')
const { MongoClient } = require('mongodb')
const { buildApp } = require('../helper')
const { randomUsername, randomEmail, randomPassword } = require('./data-creator')

async function setup(t, role = 'user') {
  const app = await buildApp(t)

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
    const client = new MongoClient('mongodb://localhost:27017')
    await client.connect()

    const adminDb = client.db().admin()
    const { databases } = await adminDb.listDatabases()

    for (const dbInfo of databases) {
      const db = client.db(dbInfo.name)
      await db.collection('users').updateOne(
        { username: username },
        { $set: { role: role } }
      )
    }

    await client.close()
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
  const refreshCookieStr = cookies.find(c => c && c.startsWith('refreshToken=')) || ''
  const refreshToken = refreshCookieStr.split(';')[0].split('=')[1]
  const userId = responseData.user.id

  return { app, accessToken, refreshToken, userId, username, password }
}

module.exports = { setup }