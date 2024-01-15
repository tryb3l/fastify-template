"use strict";
const fp = require("fastify-plugin");
const schemas = require("./schemas/loader");
module.exports = fp(
  async function noteAutoHooks(fastify, _opts) {
    const notes = fastify.mongo.db.collection("notes");
    await fastify.register(schemas);
    fastify.decorateRequest("notesDataSource", null);
    fastify.addHook("onRequest", async (request, reply) => {
      request.notesDataSource = {
        async countNotes(filter = {}) {
          filter.userId = request.user.id;
          const totalCount = await notes.countDocuments(filter);
          return totalCount;
        },
        async readNote(id, projection = {}) {
          const note = await notes.findOne(
            { _id: new fastify.mongo.ObjectId(id), userId: request.user.id },
            { projection: { ...projection, _id: 0 } },
          );
          return note;
        },
        async listNotes({
          filter = {},
          projection = {},
          skip = 0,
          limit = 50,
          asStream = false,
        } = {}) {
          if (filter.title) {
            filter.title = new RegExp(filter.title, "i");
          } else {
            delete filter.title;
          }
          const cursor = await notes.find(filter, {
            projection: { ...projection, _id: 0 },
            limit,
            skip,
          });
          if (asStream) {
            return cursor.stream();
          }
          return cursor.toArray();
        },
        async createNote({ title }) {
          const _id = new fastify.mongo.ObjectId();
          const now = new Date();
          const userId = request.user.id;
          const { insertedId } = await notes.insertOne({
            _id,
            userId,
            title,
            done: false,
            id: _id,
            createdAt: now,
            modifiedAt: now,
          });
          return insertedId;
        },
        async createNotes(noteList) {
          const now = new Date();
          const userId = request.user.id;
          const toInsert = noteList.map((rawNote) => {
            const _id = new fastify.mongo.ObjectId();
            return {
              _id,
              userId,
              ...rawNote,
              id: _id,
              createdAt: now,
              modifiedAt: now,
            };
          });
          await notes.insertMany(toInsert);
          return toInsert.map(({ note }) => note._id);
        },
        async updateNote(id, newNote) {
          return notes.updateOne(
            { _id: new fastify.mongo.ObjectId(id), userId: request.user.id },
            {
              $set: {
                ...newNote,
                modifiedAt: new Date(),
              },
            },
          );
        },
        async deleteNote(id) {
          return notes.deleteOne({
            _id: new fastify.mongo.ObjectId(id),
            userId: request.user.id,
          });
        },
      };
    });
  },
  { encapsulate: true, dependencies: ["@fastify/mongodb"], name: "note-store" },
);
