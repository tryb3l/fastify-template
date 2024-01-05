"use strict";

module.exports = async function exampleRoutes(fastify, _opts) {
  fastify.route({
    method: "GET",
    url: "/",
    schema: {
      queryString: fastify.getSchema("schema:example:todo:list:query"),
      response: {
        200: fastify.getSchema("schema:example:list:response"),
      },
    },
    handler: async function listExample(request, reply) {
      const { skip, limit, title } = request.query;

      const examples = await this.mongoDataSource.listExamples({
        filter: { title },
        skip,
        limit,
      });

      const totalCount = await this.mongoDataSource.countExamples();
      return { data: examples, totalCount };
    },
  });

  fastify.route({
    method: "POST",
    url: "/",
    schema: {
      body: fastify.getSchema("schema:example:create:body"),
      response: {
        201: fastify.getSchema("schema:example:create:response"),
      },
    },
    handler: async function createExample(request, reply) {
      const insertedId = await this.mongoDataSource.createExample(request.body);
      reply.code(201);
      return { id: insertedId };
    },
  });

  fastify.route({
    method: "GET",
    url: "/:id",
    schema: {
      params: fastify.getSchema("schema:example:read:params"),
      response: {
        200: fastify.getSchema("schema:example"),
      },
    },
    handler: async function readExample(request, reply) {
      const example = await this.mongoDataSource.readExample(request.params.id);
      if (!example) {
        reply.code(404);
        return { error: "Record was not found" };
      }
      return example;
    },
  });

  fastify.route({
    method: "PUT",
    url: "/:id",
    schema: {
      params: fastify.getSchema("schema:example:read:params"),
      body: fastify.getSchema("schema:example:update:body"),
    },
    handler: async function updateExample(request, reply) {
      const res = await this.mongoDataSource.updateExample(
        request.params.id,
        request.body,
      );
      if (res.modifiedCount === 0) {
        reply.code(404);
        return { error: "Record was not found" };
      }
      reply.code(204);
    },
  });

  fastify.route({
    method: "DELETE",
    url: "/:id",
    schema: {
      params: fastify.getSchema("schema:example:read:params"),
    },
    handler: async function deleteExample(request, reply) {
      const res = await this.mongoDataSource.deleteExample(request.params.id);
      if (res.deletedCount === 0) {
        reply.code(404);
        return { error: "Record was not found" };
      }
      reply.code(204);
    },
  });

  fastify.route({
    method: "POST",
    url: "/:id/:status",
    schema: {
      params: fastify.getSchema("schema:example:status:params"),
    },
    handler: async function changeStatus(request, reply) {
      const res = await this.mongoDataSource.updateExample(request.params.id, {
        done: true,
      });
      if (res.modifiedCount === 0) {
        reply.code(404);
        return { error: "Record was not found" };
      }
      reply.code(204);
    },
  });
};
