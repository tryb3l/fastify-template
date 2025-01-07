'use strict'

const t = require('tap')
const { buildApp } = require('../../../helper')

t.test('the application should start', async (t) => {
  const app = await buildApp(t, {
    MONGO_URL: 'mongodb://localhost:27017/basic-test-db',
  })

  await app.ready()
  t.pass('the application is ready')
})

t.skip('Route is online and working', async (t) => {
  const app = await buildApp(t, {
    MONGO_URL: 'mongodb://localhost:27017/basic-test-db',
  })
  const response = await app.inject({
    method: 'GET',
    url: '/',
  })
  t.same(response.json(), { root: true })
})

t.skip('non-existent route returns 404', async (t) => {
  const app = await buildApp(t, {
    MONGO_URL: 'mongodb://localhost:27017/basic-test-db',
  })
  const response = await app.inject({
    method: 'GET',
    url: '/non-existent',
  })
  t.equal(response.statusCode, 404)
  t.same(response.json(), {
    statusCode: 404,
    error: 'Not Found',
    message: 'The requested resource could not be found',
    requestId: response.json().requestId,
  })
})
