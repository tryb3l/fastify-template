"use strict";
/**
 * Fastify plugin for loading environment variables.
 * @module configLoader
 */

const fp = require("fastify-plugin");
/**
 * Retrieves environment variables and sets them on the Fastify instance.
 * @param {import('fastify').FastifyInstance} fastify - The Fastify instance.
 * @param {object} options - The options object.
 * @param {string} options.envFile - The path to the environment file.
 * @param {boolean} [options.overrideExisting=false] - Whether to override existing environment variables.
 */
/**
 * @typedef {import("@fastify/env")} fastifyEnv
 */
const fastifyEnv = require("@fastify/env");
module.exports = fp(
  async function configLoader(fastify, opts) {
    await fastify.register(fastifyEnv, {
      confKey: "secrets",
      data: opts.configData,
      schema: fastify.getSchema("schema:dotenv"),
    });
    fastify.decorate("config", {
      mongo: {
        forceClose: true,
        url: fastify.secrets.MONGO_URL,
      },
    });
  },
  {
    dependencies: ["application-config"],
  },
);
