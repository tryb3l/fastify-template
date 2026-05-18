'use strict'

const test = require('node:test')
const assert = require('node:assert')
const Fastify = require('fastify')
const configPlugin = require('../../plugins/config')
const mailerPlugin = require('../../plugins/mailer')

function buildConfigData(env = {}) {
  return {
    MONGO_URL: 'mongodb://localhost:27017/test',
    NODE_ENV: 'test',
    JWT_SECRET: 'secret-11111111',
    COOKIE_SECRET: 'cookie-secret-11111111',
    FRONTEND_URL: 'http://localhost:5173',
    ...env,
  }
}

test('application-config defaults development SMTP to local Mailpit when SMTP env is absent', async (t) => {
  const app = Fastify({ logger: false })

  t.after(async () => {
    await app.close()
  })

  await app.register(configPlugin, {
    configData: buildConfigData({ NODE_ENV: 'development' }),
  })

  assert.strictEqual(app.config.mailer.smtp.host, '127.0.0.1')
  assert.strictEqual(app.config.mailer.smtp.port, 1025)
  assert.strictEqual(app.config.mailer.smtp.secure, false)
})

test('mailer plugin requires SMTP outside development and test', async (t) => {
  const app = Fastify({ logger: false })

  t.after(async () => {
    await app.close().catch(() => {})
  })

  app.register(configPlugin, {
    configData: buildConfigData({ NODE_ENV: 'production' }),
  })
  app.register(mailerPlugin)

  await assert.rejects(
    () => app.ready(),
    (err) => err.code === 'SMTP_CONFIG_REQUIRED',
  )
})
