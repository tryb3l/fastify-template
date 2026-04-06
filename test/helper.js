'use strict'

const fcli = require('fastify-cli/helper')

const startArgs = '-l silent --options app.js'

const defaultEnv = {
  MONGO_URL: 'mongodb://localhost:27017/test',
  NODE_ENV: 'test',
  JWT_SECRET: 'secret-11111111',
}

function getTestEnv(env = {}) {
  return { ...defaultEnv, ...env }
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