"use strict";
const fp = require("fastify-plugin");
const schemas = require("./schemas/loader");
module.exports = fp(async function noteAutoHooks(fastify, _opts) {
  const notes = fastify.mongo.db.collection("notes");
  await fastify.register(schemas);
  fastify.decorate("mongoDataSource", {
    async countNotes(filter = {}) {
      const totalCount = await notes.countDocuments(filter);
      return totalCount;
    },
    async readNote(id, projection = {}) {
      const note = await notes.findOne(
        { _id: new fastify.mongo.ObjectId(id) },
        { projection: { ...projection, _id: 0 } },
      );
      return note;
    },
    async listNotes({
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
      const noteDocuments = await notes
        .find(filter, {
          projection: { ...projection, _id: 0 },
          limit,
          skip,
        })
        .toArray();
      return noteDocuments;
    },
    async createNote({ title }) {
      const _id = new fastify.mongo.ObjectId();
      const now = new Date();
      const { insertedId } = await notes.insertOne({
        _id,
        title,
        done: false,
        id: _id,
        createdAt: now,
        modifiedAt: now,
      });
      return insertedId;
    },
    async updateNote(id, newNote) {
      return notes.updateOne(
        { _id: new fastify.mongo.ObjectId(id) },
        {
          $set: {
            ...newNote,
            modifiedAt: new Date(),
          },
        },
      );
    },
    async deleteNote(id) {
      return notes.deleteOne({ _id: new fastify.mongo.ObjectId(id) });
    },
  });
});
