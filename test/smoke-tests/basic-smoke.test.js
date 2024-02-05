"use strict";

const fcli = require("fastify-cli/helper");
const startArgs = "-l info --options app.js";
const t = require("tap");

t.test("the application should start", async (t) => {
  const envParam = {
    NODE_ENV: "test",
    MONGO_URL: "mongodb://localhost:27017/test",
  };

  const app = await fcli.build(startArgs, {
    configData: envParam,
  });

  t.teardown(() => {
    app.close();
  });

  await app.ready();

  t.pass("the application is ready");
});

t.test("Route is online and working", async (t) => {
  const app = await fcli.build(t);
  const response = await app.inject({
    method: "GET",
    url: "/",
  });
  t.same(response.json(), { root: true });
});
