"use strict";

const fp = require("fastify-plugin");
const schemas = require("./../../schemas/loader");

module.exports = fp(
  async function exampleAutoHooks(fastify, opts) {
    const example = fastify.mongo.db.collection("example");

    fastify.register(schemas);

    fastify.decorate("mongoDataSource", {
      async countExample(filter = {}) {
        const totalCount = await example.countDocuments(filter);
        return totalCount;
      },

      async listExamples({
        filter = {},
        projection = {},
        skip = 0,
        limit = 50,
      } = {}) {
        if (filter.title) {
          filter.title = new RegExp(filter.title, "i");
        } else {
          delete filter.title;
        }
        const exampleDocuments = await example
          .find(filter, {
            projection: { ...projection, _id: 0 },
            limit,
            skip,
          })
          .toArray();
        return exampleDocuments;
      },
      async createExample({ title }) {
        const _id = new fastify.mongo.ObjectId();
        const now = new Date();
        const { insertedId } = await example.insertOne({
          _id,
          title,
          done: false,
          id: _id,
          createdAt: now,
          modifiedAt: now,
        });
        return insertedId;
      },
      async readExample(id, projection = {}) {
        const example = await example.findOne(
          { _id: new fastify.mongo.ObjectId(id) },
          { projection: { ...projection, _id: 0 } },
        );
        return example;
      },
      async updateExample(id, newExample) {
        return example.updateOne(
          { _id: new fastify.mongo.ObjectId(id) },
          {
            $set: {
              ...newExample,
              modifiedAt: new Date(),
            },
          },
        );
      },
      async deleteExample(id) {
        return examples.deleteOne({ _id: new fastify.mongo.ObjectId(id) });
      },
    });
  },
  {
    encapsulate: true,
    dependencies: ["@fastify/mongodb"],
    name: "example-store",
  },
);
