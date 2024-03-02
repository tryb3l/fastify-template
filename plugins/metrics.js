"use strict";

const fp = require("fastify-plugin");
const Fastify = require("fastify");
module.exports = fp(async function (app) {
  app.register(require("fastify-metrics"), {
    defaultMetrics: { enabled: true },
    endpoint: null,
    name: "metrics",
    routeMetrics: { enable: true },
  });
  const promServer = Fastify({ logger: app.log });
  promServer.route({
    url: "/metrics",
    method: "GET",
    logLever: "info",
    handler: (_, reply) => {
      reply.type("text/plain");
      return app.metrics.client.register.metrics();
    },
  });
  app.addHook("onClose", async (instance) => {
    await promServer.close();
  });
  await promServer.listen(
    {
      port: 9001,
      host: "0.0.0.0",
    },
    { name: prom },
  );
});
