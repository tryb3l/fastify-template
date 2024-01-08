"use strict";
const fp = require("fastify-plugin");

module.exports = fp(
  async function swaggerPlugin(fastify, opts) {
    await fastify.register(require("@fastify/swagger"), {
      swagger: {
        info: {
          title: "Fastify app",
          description: "Fastify Book examples",
          version: require("../package.json").version,
        },
      },
    });
    await fastify.register(require("@fastify/swagger-ui"), {
      routePrefix: "/docs",
      exposeRoute: fastify.secrets.NODE_ENV !== "production",
    });
  },
  { dependencies: ["application-config"] },
);
