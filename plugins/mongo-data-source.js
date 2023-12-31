"use strict";

const fp = require("fastify-plugin");
/**
 * Fastify MongoDB plugin. It will connect to the database and expose the db object
 * @type {import("@fastify/mongodb")}
 */
const fastifyMongo = require("@fastify/mongodb");
module.exports = fp(
  async function (fastify, opts) {
    fastify.register(fastifyMongo, {
      forceClose: true,
      url: fastify.configSecret.MONGO_URL,
    });
  },
  { dependencies: ["application-config"] },
);
