"use strict";
/**
 * Fastify plugin for loading configuration from environment variables.
 * @module plugins/config
 */

const fp = require("fastify-plugin");
const fastifyEnv = require("@fastify/env");

module.exports = fp(
  /**
   * Registers the fastify-env plugin to load configuration from environment variables.
   * @param {Object} fastify - The Fastify instance.
   * @param {Object} opts - The plugin options.
   * @param {Function} next - The callback function to continue the plugin registration.
   */
  function (fastify, opts, next) {
    fastify.register(fastifyEnv, {
      confKey: "configSecret",
      schema: fastify.getSchema("schema:dotenv"),
    });
    next();
  },
  { name: "application-config" },
);
