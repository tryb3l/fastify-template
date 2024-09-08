'use strict'

const t = require('tap')
const { buildApp } = require('../../helper')

t.skip('register the user', async (t) => {
  const app = await buildApp(t, {
    MONGO_URL: 'mongodb://localhost:27017/login-test-db',
  })
  const response = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: {
      username: 'John Doe',
      email: 'doe@email.com',
      password: 'icanpa123123ss',
    },
  })
  t.equal(response.statusCode, 201)
  t.same(response.json(), { registered: true })
})

function cleanCache() {
  Object.keys(require.cache).forEach(function (key) {
    delete require.cache[key]
  })
}

t.skip('failed signup, invalid email format', async (t) => {
  const path = '../../routes/data-store.js'
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
  const response = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: {
      username: '123',
      password: 'icanpass',
      email: 'fake#email.com',
    },
  })
  t.equal(response.statusCode, 400)
})
