"use strict";
const crypto = require("crypto");

module.exports = async function exampleRoutes(fastify, _opts) {
  fastify.route({
    method: "GET",
    url: "/",
    handler: async function listExamples(request, reply) {
      return { data: [], totalCount: 0 };
    },
  });
  fastify.route({
    method: "POST",
    url: "/",
    handler: async function createExample(request, reply) {
      return { id: crypto.randomUUID() };
    },
  });
  fastify.route({
    method: "GET",
    url: "/:id",
    handler: async function readExample(request, reply) {
      return {};
    },
  });
  fastify.route({
    method: "PUT",
    url: "/:id",
    handler: async function updateExample(request, reply) {
      reply.code(204);
    },
  });
  fastify.route({
    method: "DELETE",
    url: "/:id",
    handler: async function deleteExample(request, reply) {
      reply.code(204);
    },
  });
  fastify.route({
    method: "POST",
    url: "/:id/:status",
    handler: async function updateStatusExample(request, reply) {
      reply.code(204);
    },
  });
};
