'use strict'

module.exports = async function noteRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate)

  const notes = fastify.mongo.db.collection('notes')
  fastify.route({
    method: 'GET',
    url: '/',
    schema: {
      tags: ['notes'],
      summary: 'List notes',
      queryString: fastify.getSchema('schema:note:list:query'),
      response: {
        200: fastify.getSchema('schema:note:list:response'),
      },
    },
    handler: async function listNotesHandler(request, reply) {
      const { skip, limit, title } = request.query
      if (skip < 0 || limit < 0) {
        return reply.status(400).send({ message: 'Skip and limit must be non-negative integers' })
      }
      const notes = await request.notesDataSource.listNotes({
        filter: { title },
        skip,
        limit,
      })
      const totalCount = await request.notesDataSource.countNotes()
      reply.code(201)
      return { data: notes, totalCount }
    },
  })

  fastify.route({
    method: 'POST',
    url: '/',
    schema: {
      tags: ['notes'],
      summary: 'Create a note',
      body: fastify.getSchema('schema:note:create:body'),
      response: {
        201: fastify.getSchema('schema:note:create:response'),
      },
    },
    handler: async function createNoteHandler(request, reply) {
      const insertedId = await request.notesDataSource.createNote(request.body)
      try {
        reply.code(201)
      } catch (error) {
        console.error('Error creating note:', error)
        reply.code(500)
        return { error: 'Internal Server Error' }
      }
      return { id: insertedId }
    },
  })

  fastify.route({
    method: 'GET',
    url: '/:id',
    schema: {
      tags: ['notes'],
      summary: 'Read a note by id',
      params: fastify.getSchema('schema:note:read:params'),
      response: {
        200: fastify.getSchema('schema:note'),
      },
    },
    handler: async function readNoteHandler(request, reply) {
      try {
        const { id } = request.params
        const note = await request.notesDataSource.readNote(id)
        if (!note) {
          reply.code(404)
          return { error: 'Note not found' }
        }
        reply.send({ data: note })
      } catch (error) {
        console.error('Error fetching note details:', error)
        reply.code(500)
        return { error: error.message || 'Internal Server Error' }
      }
    },
  })

  fastify.route({
    method: 'PUT',
    url: '/:id',
    schema: {
      tags: ['notes'],
      summary: 'Update a note by id',
      params: fastify.getSchema('schema:note:read:params'),
      body: fastify.getSchema('schema:note:update:body'),
    },
    handler: async function updateNoteHandler(request, reply) {
      const { id } = request.params
      const res = await request.notesDataSource.updateNote(id, request.body)
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
      tags: ['notes'],
      summary: 'Delete a note by id',
      params: fastify.getSchema('schema:note:read:params'),
    },
    handler: async function deleteNoteHandler(request, reply) {
      const { id } = request.params
      const res = await notes.deleteOne({
        _id: id,
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
      tags: ['notes'],
      summary: 'Change note status by id',
      params: fastify.getSchema('schema:note:status:params'),
      response: {
        204: fastify.getSchema('schema:note:status:response'),
      },
    },
    handler: async function changeStatusHandler(request, reply) {
      const { id } = request.params
      const res = await notes.updateOne(
        { _id: id },
        {
          $set: {
            status: request.params.status,
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
