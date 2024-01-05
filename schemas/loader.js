"use strict";
/**
 * Fastify plugin function. It must add all the JSON schemas we will need for our application
 * @typedef {import('fastify').FastifyPluginCallback} FastifyPluginCallback
 */

const fp = require("fastify-plugin");

module.exports = fp(function schemaLoaderPlugin(fastify, opts, next) {
  fastify.addSchema(require("./dotenv.json"));

  next();
});
