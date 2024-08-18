'use strict'

const t = require('tap')
const { buildApp } = require('../helper')
const { generateKey } = require('../../utils/crypto')

const randomUsername = generateKey(8, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ')
const randomEmail = `${generateKey(5, 'abcdefghijklmnopqrstuvwxyz')}@${generateKey(5, 'abcdefghijklmnopqrstuvwxyz')}.com`
const randomPassword = generateKey(
  12,
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
)

t.test('register the user', async (t) => {
  const app = await buildApp(t, {
    MONGO_URL: 'mongodb://localhost:27017/login-test-db',
  })
  const response = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: {
      username: randomUsername,
      email: randomEmail,
      password: randomPassword,
    },
  })
  t.equal(response.statusCode, 201)
  t.same(response.json(), { registered: true })
})
