'use strict'

const fcli = require('fastify-cli/helper')

const startArgs = '-l silent --options app.js'

function getDefaultEnv() {
  return {
    MONGO_URL: process.env.MONGO_URL || 'mongodb://localhost:27017/test',
    NODE_ENV: 'test',
    JWT_SECRET: process.env.JWT_SECRET || 'secret-11111111',
    COOKIE_SECRET: process.env.COOKIE_SECRET || 'cookie-secret-11111111',
    FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5173',
  }
}

function getTestEnv(env = {}) {
  return { ...getDefaultEnv(), ...env }
}

function getTestMongoUrl(env = {}) {
  return getTestEnv(env).MONGO_URL
}

function config(env) {
  return { configData: env }
}

// automatically build and tear down our instance
async function buildApp(t, env, serverOptions) {
  const app = await fcli.build(startArgs, config(getTestEnv(env)), serverOptions)

  t.after(async () => {
    await app.close()
  })

  return app
}

module.exports = {
  config,
  buildApp,
  getTestEnv,
  getTestMongoUrl,
}
