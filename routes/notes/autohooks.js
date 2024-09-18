// routes/notes/autohooks.js
'use strict'
const fp = require('fastify-plugin')
const schemas = require('./schemas/loader')
const { randomUUID } = require('node:crypto')
const { createNotFoundError, handleReadNoteError } = require('../../utils/error')

module.exports = fp(
  async function noteAutoHooks(fastify) {
    const notes = fastify.mongo.db.collection('notes')

    fastify.register(schemas)

    fastify.decorateRequest('notesDataSource', null)

    fastify.addHook('onRequest', async (request, reply) => {
      request.notesDataSource = {
        async countNotes(filter = {}) {
          filter.userId = request.user.id
          const totalCount = await notes.countDocuments(filter)
          return totalCount
        },

        async listNotes({
          filter = {},
          projection = {},
          skip = 0,
          limit = 50,
          asStream = false,
        } = {}) {
          if (filter.title) {
            filter.title = new RegExp(filter.title, 'i')
          } else {
            delete filter.title
          }
          const cursor = await notes.find(filter, {
            projection: { ...projection, _id: 0 },
            limit,
            skip,
          })
          if (asStream) {
            return cursor.stream()
          }
          return cursor.toArray()
        },

        async createNote({ title, body, tags }) {
          const _id = randomUUID()
          const now = new Date()
          const userId = request.user.id
          const { insertedId } = await notes.insertOne({
            _id,
            userId,
            title,
            body,
            tags,
            id: _id,
            createdAt: now,
            modifiedAt: now,
          })
          return insertedId
        },

        async createNotes(noteList) {
          const now = new Date()
          const userId = request.user.id
          const toInsert = noteList.map((rawNote) => {
            const _id = new fastify.mongo.ObjectId()
            return {
              _id,
              userId,
              ...rawNote,
              id: _id,
              createdAt: now,
              modifiedAt: now,
            }
          })
          await notes.insertMany(toInsert)
          return toInsert.map((note) => note._id)
        },

        async readNote(id, projection = {}) {
          try {
            const note = await notes.findOne(
              { _id: id, userId: request.user.id },
              {
                projection: {
                  _id: 1,
                  id: 1,
                  title: 1,
                  body: 1,
                  tags: 1,
                  createdAt: 1,
                  modifiedAt: 1,
                  ...projection,
                },
              },
            )
            if (!note) {
              request.log.info(`Note not found for ID: ${id} and User ID: ${request.user.id}`)
              throw createNotFoundError('Note not found')
            }
            return note
          } catch (error) {
            return handleReadNoteError(error, request, reply)
          }
        },

        async updateNote(id, newNote) {
          return notes.updateOne(
            { _id: id, userId: request.user.id },
            {
              $set: {
                ...newNote,
                modifiedAt: new Date(),
              },
            },
          )
        },

        async deleteNote(id) {
          return notes.deleteOne({
            _id: id,
          })
        },
      }
    })
  },
  {
    encapsulate: true,
    dependencies: ['@fastify/mongodb'],
    name: 'note-store',
  },
)
