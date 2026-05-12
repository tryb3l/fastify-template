'use strict'

const fp = require('fastify-plugin')
const { randomUUID } = require('node:crypto')
const { instantToDate, nowInstant, parseIsoInstant } = require('../utils/time')

const normalizeNoteBody = (body) => (typeof body === 'string' ? body : '')

const normalizePersistedNote = (note) => ({
  ...note,
  body: normalizeNoteBody(note.body),
})

module.exports = fp(
  async function notesStorePlugin(fastify) {
    fastify.log.info('Starting registration of notes-store plugin')

    const notes = fastify.mongo.db.collection('notes')

    const notesDataSource = {
      _buildFilter(rawFilter = {}, userId) {
        const finalFilter = { userId }
        if (rawFilter.title) {
          finalFilter.title = new RegExp(rawFilter.title, 'i')
        }
        return finalFilter
      },

      async countNotes(filter = {}, userId) {
        fastify.log.info('Entering countNotes method')
        const finalFilter = this._buildFilter(filter, userId)
        const totalCount = await notes.countDocuments(finalFilter)
        fastify.log.info('Exiting countNotes method')
        return totalCount
      },

      async listNotes(
        { filter = {}, projection = {}, skip = 0, limit = 50, asStream = false } = {},
        userId,
      ) {
        fastify.log.info('Entering listNotes method')
        const finalFilter = this._buildFilter(filter, userId)

        const cursor = await notes.find(finalFilter, {
          projection: { ...projection, _id: 0 },
          limit,
          skip,
        })
        if (asStream) {
          fastify.log.info('Exiting listNotes method with stream')
          return cursor.stream()
        }
        fastify.log.info('Exiting listNotes method')
        return cursor.toArray()
      },

      async createNote({ title, body, tags }, userId) {
        fastify.log.info('Entering createNote method')
        const _id = randomUUID()
        const now = new Date()
        const note = {
          userId,
          title,
          body: normalizeNoteBody(body),
          tags,
          attachments: [],
          id: _id,
          createdAt: now,
          modifiedAt: now,
        }
        await notes.insertOne(note)
        fastify.log.info('Exiting createNote method')
        return normalizePersistedNote(note)
      },

      async createNotes(noteList, userId) {
        fastify.log.info('Entering createNotes method')
        const now = new Date()
        const toInsert = noteList.map((rawNote) => {
          const _id = randomUUID()
          return {
            _id,
            userId,
            ...rawNote,
            body: normalizeNoteBody(rawNote.body),
            attachments: rawNote.attachments || [],
            id: _id,
            createdAt: now,
            modifiedAt: now,
          }
        })
        await notes.insertMany(toInsert)
        fastify.log.info('Exiting createNotes method')
        return toInsert.map((note) => note._id)
      },

      async readNote(id, userId, projection = {}) {
        fastify.log.info('Entering readNote method')
        const note = await notes.findOne(
          { id: id, userId: userId },
          {
            projection: {
              _id: 0,
              id: 1,
              title: 1,
              body: 1,
              tags: 1,
              attachments: 1,
              createdAt: 1,
              modifiedAt: 1,
              ...projection,
            },
          },
        )
        if (!note) {
          fastify.log.info(`Note not found for ID: ${id} and User ID: ${userId}`)
          throw fastify.httpErrors.notFound('Note not found')
        }
        fastify.log.info('Exiting readNote method')
        return normalizePersistedNote(note)
      },

      async updateNote(id, newNote, userId) {
        const { expectedModifiedAt, ...rawUpdate } = newNote
        const normalizedUpdate = {
          ...rawUpdate,
        }

        let expectedModifiedAtDate = null

        if (expectedModifiedAt !== undefined) {
          try {
            expectedModifiedAtDate = instantToDate(parseIsoInstant(expectedModifiedAt))
          } catch {
            throw fastify.httpErrors.badRequest('expectedModifiedAt must be a valid date-time')
          }
        }

        if (Object.hasOwn(normalizedUpdate, 'body')) {
          normalizedUpdate.body = normalizeNoteBody(normalizedUpdate.body)
        }

        const result = await notes.findOneAndUpdate(
          expectedModifiedAtDate
            ? { id, userId, modifiedAt: expectedModifiedAtDate }
            : { id, userId },
          {
            $set: {
              ...normalizedUpdate,
              modifiedAt: instantToDate(nowInstant()),
            },
          },
          { returnDocument: 'after' },
        )

        const updatedNote = result?.value ?? result

        if (!updatedNote) {
          const existingNote = await notes.findOne(
            { id, userId },
            {
              projection: {
                _id: 0,
                modifiedAt: 1,
              },
            },
          )

          if (!existingNote) {
            throw fastify.httpErrors.notFound('Note not found')
          }

          if (expectedModifiedAtDate) {
            const conflictError = fastify.httpErrors.conflict(
              'Note was modified elsewhere. Reload the latest note before saving again.',
            )
            conflictError.conflictCode = 'NOTE_STALE_SAVE'
            conflictError.currentModifiedAt = existingNote.modifiedAt
            throw conflictError
          }

          throw fastify.httpErrors.notFound('Note not found')
        }

        return normalizePersistedNote(updatedNote)
      },

      async deleteNote(id, userId) {
        fastify.log.info('Entering deleteNote method')
        const result = await notes.deleteOne({
          id: id,
          userId: userId,
        })

        if (result.deletedCount === 0) {
          fastify.log.info(`Note not found for ID: ${id} and User ID: ${userId}`)
          throw fastify.httpErrors.notFound('Note not found')
        }
        fastify.log.info('Exiting deleteNote method')
      },

      async addAttachments(id, attachments, userId) {
        const result = await notes.findOneAndUpdate(
          { id, userId },
          {
            $push: { attachments: { $each: attachments } },
            $set: { modifiedAt: new Date() },
          },
          { returnDocument: 'after' },
        )

        const updatedNote = result?.value ?? result

        if (!updatedNote) {
          throw fastify.httpErrors.notFound('Note not found')
        }

        return updatedNote
      },
    }

    fastify.decorate('notesDataSource', notesDataSource)
    fastify.log.info('Successfully registered notes-store plugin')
  },
  {
    dependencies: ['db-plugin'],
    name: 'notes-store',
    decorators: {
      fastify: ['mongo'],
    },
  },
)
