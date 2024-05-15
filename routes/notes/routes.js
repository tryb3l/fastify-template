'use strict'

module.exports = async function noteRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate)
  const notes = fastify.mongo.db.collection('notes')
  fastify.route({
    method: 'GET',
    url: '/',
    schema: {
      tags: ['note'],
      queryString: fastify.getSchema('schema:note:list:query'),
      response: {
        200: fastify.getSchema('schema:note:list:response'),
      },
    },
    handler: async function listNotes(request) {
      const { skip, limit, title } = request.query
      const notes = await this.notesDataSource.listNotes({
        filter: { title },
        skip,
        limit,
      })
      const totalCount = await this.notesDataSource.countNotes()
      return { data: notes, totalCount }
    },
  })

  fastify.route({
    method: 'POST',
    url: '/',
    schema: {
      tags: ['note'],
      body: fastify.getSchema('schema:note:create:body'),
      response: {
        201: fastify.getSchema('schema:note:create:response'),
      },
    },
    handler: async function createNote(request, reply) {
      const insertedId = await this.notesDataSource.createNote(request.body)
      reply.code(201)
      return { id: insertedId }
    },
  })

  fastify.route({
    method: 'GET',
    url: '/:id',
    schema: {
      tags: ['note'],
      params: fastify.getSchema('schema:note:read:params'),
      response: {
        200: fastify.getSchema('schema:note'),
      },
    },
    handler: async function readNote(request, reply) {
      const note = await this.notesDataSource.readNote(request.params.id)
      if (!note) {
        reply.code(404)
        return { error: 'Record is not found' }
      }
      return note
    },
  })
  
  fastify.route({
    method: 'PUT',
    url: '/:id',
    schema: {
      tags: ['note'],
      params: fastify.getSchema('schema:note:read:params'),
      body: fastify.getSchema('schema:note:update:body'),
    },
    handler: async function updateNote(request, reply) {
      const res = await this.notesDataSource.updateNote(request.params.id, request.body)
      if (res.modifiedCount === 0) {
        reply.code(404)
        return { error: 'Record is not found' }
      }
      reply.code(204)
    },
  })

  fastify.route({
    method: 'DELETE',
    url: '/:id',
    schema: {
      tags: ['note'],
      params: fastify.getSchema('schema:note:read:params'),
    },
    handler: async function deleteNote(request, reply) {
      const res = await notes.deleteOne({
        _id: new fastify.mongo.ObjectId(request.params.id),
      })
      if (res.deletedCount === 0) {
        reply.code(404)
        return { error: 'Record is not found' }
      }
      reply.code(204)
    },
  })

  fastify.route({
    method: 'POST',
    url: '/:id/:status',
    schema: {
      tags: ['note'],
      params: fastify.getSchema('schema:note:status:params'),
      response: {
        204: fastify.getSchema('schema:note:status:response'),
      },
    },
    handler: async function changeStatus(request, reply) {
      const active = request.params.status === 'active'
      const res = await notes.updateOne(
        { _id: new fastify.mongo.ObjectId(request.params.id) },
        {
          $set: {
            active,
            modifiedAt: new Date(),
          },
        },
      )
      if (res.modifiedCount === 0) {
        reply.code(404)
        return { error: 'Record is not found' }
      }
      reply.code(204)
    },
  })
}
