"use strict";
/**
 * Registers the Swagger plugin for Fastify.
 *
 * @param {object} fastify - The Fastify instance.
 * @param {object} opts - The options object.
 * @returns {Promise<void>} - A promise that resolves when the plugin is registered.
 */
module.exports = fp(
  async function swaggerPlugin(fastify, opts) {
    fastify.register(require("@fastify/swagger"), {
      swagger: {
        info: {
          title: "Fastify app",
          description: "Fastify Book examples",
          version: require("../package.json").version,
        },
      },
    });
    fastify.register(require("@fastify/swagger-ui"), {
      routePrefix: "/docs",
      exposeRoute: fastify.secrets.NODE_ENV !== "production",
    });
  },
  { dependencies: ["application-config"] },
);
