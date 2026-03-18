'use strict'

const { buildApp } = require('../helper')
const { randomUsername, randomEmail, randomPassword } = require('./data-creator')

async function setup(t, role = 'user') { 
  const app = await buildApp(t, {
    MONGO_URL: 'mongodb://localhost:27017/test-db',
  })

  const username = randomUsername(12)
  const email = randomEmail(10, 5)
  const password = randomPassword(15)

  const registerResponse = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { username, email, password },
  })
  
  t.equal(registerResponse.statusCode, 201)

  if (role !== 'user') {
    const usersCollection = app.mongo.db.collection('users')
    await usersCollection.updateOne({ username: username }, { $set: { role: role } })
  }

  const loginResponse = await app.inject({
    method: 'POST',
    url: '/auth/authenticate',
    payload: { username, password },
  })

  t.equal(loginResponse.statusCode, 200)

  const cookies = loginResponse.cookies
  const accessTokenCookie = cookies.find((cookie) => cookie.name === 'accessToken')
  const refreshTokenCookie = cookies.find((cookie) => cookie.name === 'refreshToken')

  const accessToken = accessTokenCookie.value
  const refreshToken = refreshTokenCookie.value

  const userId = loginResponse.json().user.id

  return { app, accessToken, refreshToken, userId, username, password }
}

module.exports = { setup }