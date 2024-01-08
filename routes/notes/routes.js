"use strict";
module.exports = async function noteRoutes(fastify, _opts) {
  const notes = fastify.mongo.db.collection("notes");
  fastify.route({
    method: "GET",
    url: "/",
    handler: async function listNotes(request, reply) {
      const { skip, limit, title } = request.query;
      const filter = title ? { title: new RegExp(title, "i") } : {};
      const data = await notes
        .find(filter, {
          limit,
          skip,
        })
        .toArray();
      const totalCount = await notes.countDocuments(filter);
      return { data, totalCount };
    },
  });
  fastify.route({
    method: "POST",
    url: "/",
    handler: async function createNote(request, reply) {
      const _id = new this.mongo.ObjectId();
      const now = new Date();
      const createdAt = now;
      const modifiedAt = now;
      const newNote = {
        _id,
        id: _id,
        ...request.body,
        done: false,
        createdAt,
        modifiedAt,
      };
      await notes.insertOne(newNote);
      reply.code(201);
      return { id: _id };
    },
  });
  fastify.route({
    method: "GET",
    url: "/:id",
    handler: async function readNote(request, reply) {
      const note = await notes.findOne(
        {
          _id: new this.mongo.ObjectId(request.params.id),
        },
        { projection: { _id: 0 } },
      );
      if (!note) {
        reply.code(404);
        return { error: "Record is not found" };
      }
      return note;
    },
  });
  fastify.route({
    method: "PUT",
    url: "/:id",
    handler: async function updateNote(request, reply) {
      const res = await notes.updateOne(
        { _id: new fastify.mongo.ObjectId(request.params.id) },
        {
          $set: {
            ...request.body,
            modifiedAt: new Date(),
          },
        },
      );
      if (res.modifiedCount === 0) {
        reply.code(404);
        return { error: "Record is not found" };
      }
      reply.code(204);
    },
  });
  fastify.route({
    method: "DELETE",
    url: "/:id",
    handler: async function deleteNote(request, reply) {
      const res = await notes.deleteOne({
        _id: new fastify.mongo.ObjectId(request.params.id),
      });
      if (res.deletedCount === 0) {
        reply.code(404);
        return { error: "Record is not found" };
      }
      reply.code(204);
    },
  });
  fastify.route({
    method: "POST",
    url: "/:id/:status",
    handler: async function changeStatus(request, reply) {
      const done = request.params.status === "done";
      const res = await notes.updateOne(
        { _id: new fastify.mongo.ObjectId(request.params.id) },
        {
          $set: {
            done,
            modifiedAt: new Date(),
          },
        },
      );
      if (res.modifiedCount === 0) {
        reply.code(404);
        return { error: "Record is not found" };
      }
      reply.code(204);
    },
  });
};
