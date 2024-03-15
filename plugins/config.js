"use strict";

const fp = require("fastify-plugin");
const fastifyEnv = require("@fastify/env");

module.exports = fp(
  async function registerPluginsAndConfig() {
    await fastify.register(fastifyEnv, {
      confKey: "secrets",
      data: opts.configData,
      schema: fastify.getSchema("schema:dotenv"),
    });

    fastify.log.level = fastify.secrets.LOG_LEVEL;

    fastify.decorate("config", {
      jwt: {
        secret: fastify.secrets.JWT_SECRET,
      },
    });
  },

  { name: "application-config", dependencies: ["application-schemas"] },
);
