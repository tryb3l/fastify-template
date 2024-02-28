"use strict";

const fcli = require("fastify-cli/helper");
const startArgs = "-l info --options app.js";
const t = require("tap");
const dockerHelper = require("../helper-docker");
const docker = dockerHelper();
const { buildApp } = require("../helper");

t.test("the application should start", async (t) => {
  const app = await buildApp(t, {
    MONGO_URL: "mongodb://localhost:27017/basis-test-db",
  });

  await app.ready();
  t.pass("the application is ready");
});

t.test("Route is online and working", async (t) => {
  const app = await buildApp(t, {
    MONGO_URL: "mongodb://localhost:27017/basis-test-db",
  });
  const response = await app.inject({
    method: "GET",
    url: "/",
  });
  t.same(response.json(), { root: true });
});
