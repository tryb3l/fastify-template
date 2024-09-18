'use strict'

const t = require('tap')
const { buildApp } = require('../../helper')

t.test('cannot access protected routes', async (t) => {
  // Arrange
  const app = await buildApp(t, {
    MONGO_URL: 'mongodb://localhost:27017/login-test-db',
  })
  const privateRoutes = ['/auth/me']

  // Act/Assert
  for (const url of privateRoutes) {
    const response = await app.inject({ method: 'GET', url })
    t.equal(response.statusCode, 401)
    t.same(response.json(), {
      statusCode: 401,
      error: 'Error',
      message: 'You are not authorized to access this resource',
      requestId: response.json().requestId,
    })
  }
})

t.test('register the user', async (t) => {
  //Arrange
  const app = await buildApp(t, {
    MONGO_URL: 'mongodb://localhost:27017/login-test-db',
  })

  //Act
  const response = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: {
      username: 'John Doe',
      email: 'doe@email.com',
      password: 'icanpa123123ss',
    },
  })

  //Assert
  t.equal(response.statusCode, 201)
  t.same(response.json(), { registered: true })
})

function cleanCache() {
  Object.keys(require.cache).forEach(function (key) {
    delete require.cache[key]
  })
}

t.test('failed signup, invalid email format', async (t) => {
  //Arrange
  const path = '../../..'
  cleanCache()
  require(path)
  require.cache[require.resolve(path)].exports = {
    async store() {
      throw new Error('Fail to store')
    },
  }
  t.teardown(cleanCache())

  const app = await buildApp(t, {
    MONGO_URL: 'mongodb://localhost:27017/login-test-db',
  })

  //Act
  const response = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: {
      username: '123',
      password: 'icanpass',
      email: 'fake#email.com',
    },
  })

  //Assert
  t.equal(response.statusCode, 400)
})

t.test('failed login', async (t) => {
  //Arrange
  const app = await buildApp(t, {
    MONGO_URL: 'mongodb://localhost:27017/login-test-db',
  })

  //Act
  const response = await app.inject({
    method: 'POST',
    url: '/auth/authenticate',
    payload: {
      username: 'test',
      password: 'wrong',
    },
  })

  //Assert
  t.equal(response.statusCode, 401)
})

t.test('successful login', async (t) => {
  //Arrange
  const app = await buildApp(t, {
    MONGO_URL: 'mongodb://localhost:27017/login-test-db',
  })

  //Act
  const login = await app.inject({
    method: 'POST',
    url: '/auth/authenticate',
    headers: {
      'Content-Type': 'application/json',
    },
    payload: {
      username: 'John Doe',
      password: 'icanpa123123ss',
    },
  })

  //Assert
  t.equal(login.statusCode, 200)
  const cookies = login.cookies
  const accessTokenCookie = cookies.find((cookie) => cookie.name === 'accessToken')
  const refreshTokenCookie = cookies.find((cookie) => cookie.name === 'refreshToken')

  t.ok(accessTokenCookie, 'accessToken cookie should be set')
  t.ok(refreshTokenCookie, 'refreshToken cookie should be set')
  t.match(accessTokenCookie.value, /.+/, 'accessToken should have a value')
  t.match(refreshTokenCookie.value, /.+/, 'refreshToken should have a value')

  t.test('access protected route', async (t) => {
    //Arrange//Act
    const response = await app.inject({
      method: 'GET',
      url: '/auth/me',
      cookies: {
        accessToken: accessTokenCookie.value,
        refreshToken: refreshTokenCookie.value,
      },
    })

    //Assert
    t.equal(response.statusCode, 200)
    t.match(response.json(), { data: { username: 'John Doe' } })
  })
})
