"use strict";
/**
 * Fastify plugin for connecting to a MongoDB data source.
 * @param {import('fastify').FastifyInstance} fastify - The Fastify instance.
 * @param {Object} opts - The plugin options.
 * @param {Object} opts.mongo - The MongoDB connection options.
 */

const fp = require("fastify-plugin");
const fastifyMongo = require("@fastify/mongodb");

module.exports = fp(async function (fastify, opts) {
  fastify.register(fastifyMongo, opts.mongo);
});
