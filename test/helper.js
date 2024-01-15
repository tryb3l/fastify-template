"use strict";

// This file contains code that we reuse
// between our tests.

const { build } = require("fastify-cli/helper");
const path = require("node:path");
const AppPath = path.join(__dirname, "..", "app.js");

const startArgs = "-l silent --options app.js";

const defaultEnv = {
  MONGO_URL: "mongodb://localhost:27017/test",
  NODE_ENV: "test",
  JWT_SECRET: "secret-11111111"
};
function config(env) {
  return { configData: env };
}

// automatically build and tear down our instance
async function buildApp(t, env, serverOptions) {
  const app = await build(
    startArgs,
    config({ ...defaultEnv, ...env }),
    serverOptions,
  );
  t.teardown(() => {
    app.close();
  });
  return app;
}

module.exports = {
  config,
  buildApp,
};
