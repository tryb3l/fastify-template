'use strict'

const { buildApp } = require('../helper')
const { randomUsername, randomEmail, randomPassword } = require('./data-creator')

async function setup(t) {
  //Register the user
  //Arrange
  const app = await buildApp(t, {
    MONGO_URL: 'mongodb://localhost:27017/test-db',
  })

  const username = randomUsername(12)
  const email = randomEmail(10, 5)
  const password = randomPassword(15)

  //Act
  const registerResponse = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: {
      username: username,
      email: email,
      password: password,
    },
  })
  //Assert
  t.equal(registerResponse.statusCode, 201)
  t.same(registerResponse.json(), { registered: true })

  //Authenticate the user
  //Arrange
  const loginResponse = await app.inject({
    method: 'POST',
    url: '/auth/authenticate',
    headers: {
      'Content-Type': 'application/json',
    },
    payload: {
      username: username,
      password: password,
    },
  })
  //Assert
  t.equal(loginResponse.statusCode, 200)
  const cookies = loginResponse.cookies
  const accessTokenCookie = cookies.find((cookie) => cookie.name === 'accessToken')
  const refreshTokenCookie = cookies.find((cookie) => cookie.name === 'refreshToken')

  t.ok(refreshTokenCookie, 'accessToken cookie should be set')
  t.ok(refreshTokenCookie, 'refreshToken cookie should be set')
  t.match(refreshTokenCookie.value, /.+/, 'accessToken should have a value')
  t.match(refreshTokenCookie.value, /.+/, 'refreshToken should have a value')

  const accessToken = accessTokenCookie.value
  const refreshToken = refreshTokenCookie.value

  return { app, accessToken, refreshToken }
}

module.exports = { setup }
