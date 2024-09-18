'use strict'

const { test } = require('tap')
const { buildApp } = require('../helper')

test('default root route', async (t) => {
  const app = await buildApp(t)

  const res = await app.inject({
    url: '/',
  })
  t.same(JSON.parse(res.payload), { root: true })
})

test('non-existent route returns 404', async (t) => {
  const app = await buildApp(t)

  const res = await app.inject({
    url: '/non-existent',
  })
  t.equal(res.statusCode, 404)
  t.same(JSON.parse(res.payload), {
    statusCode: 404,
    error: 'Not Found',
    message: 'The requested resource could not be found',
    requestId: JSON.parse(res.payload).requestId,
  })
})
