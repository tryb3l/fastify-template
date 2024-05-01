'use strict'

const t = require('tap')
const { buildApp } = require('../helper')

t.test('the application should start', async (t) => {
  const app = await buildApp(t, {
    MONGO_URL: 'mongodb://localhost:27017/basis-test-db',
  })

  await app.ready()
  t.pass('the application is ready')
})

t.test('Route is online and working', async (t) => {
  const app = await buildApp(t, {
    MONGO_URL: 'mongodb://localhost:27017/basis-test-db',
  })
  const response = await app.inject({
    method: 'GET',
    url: '/',
  })
  t.same(response.json(), { root: true })
})
