'use strict'

const fcli = require('fastify-cli/helper')

const startArgs = '-l silent --options app.js'

function resolveEnvDefault(value, fallback) {
  return value !== undefined && value !== '' ? value : fallback
}

function getDefaultEnv() {
  return {
    MONGO_URL: resolveEnvDefault(process.env.MONGO_URL, 'mongodb://localhost:27017/test'),
    NODE_ENV: 'test',
    JWT_SECRET: resolveEnvDefault(process.env.JWT_SECRET, 'secret-11111111'),
    COOKIE_SECRET: resolveEnvDefault(process.env.COOKIE_SECRET, 'cookie-secret-11111111'),
    FRONTEND_URL: resolveEnvDefault(process.env.FRONTEND_URL, 'http://localhost:5173'),
    REGISTRATION_MODE: resolveEnvDefault(process.env.REGISTRATION_MODE, 'open'),
    MONGO_MIN_POOL_SIZE: resolveEnvDefault(process.env.MONGO_MIN_POOL_SIZE, '1'),
    MONGO_MAX_POOL_SIZE: resolveEnvDefault(process.env.MONGO_MAX_POOL_SIZE, '4'),
  }
}

function getTestEnv(env = {}) {
  return { ...getDefaultEnv(), ...env }
}

function getTestMongoUrl(env = {}) {
  return getTestEnv(env).MONGO_URL
}

function config(env) {
  return { configData: env, skipOverride: true }
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
