'use strict'

const fp = require('fastify-plugin')
const crypto = require('node:crypto')
const { randomUUIDv7 } = crypto
const { instantToDate, nowInstant } = require('../utils/time')
const { LEITNER_BOX_INTERVAL_DAYS } = require('../routes/flashcards/flashcard-contract')

function normalizeFlashcardDoc(card) {
  return {
    id: card.id,
    noteId: card.noteId,
    front: card.front,
    back: card.back,
    box: Number(card.box) || 1,
    nextReviewAt: card.nextReviewAt,
    lastReviewedAt: card.lastReviewedAt ?? null,
    createdAt: card.createdAt,
    modifiedAt: card.modifiedAt,
  }
}

class ScopedNoteNode {
  constructor(note, isExternal) {
    this.id = note.id
    this.title = note.title || ''
    this.readiness = note.readiness || 'to_review'
    this.notebookId = note.notebookId ?? null
    this.folderId = note.folderId ?? null
    this.isExternal = Boolean(isExternal)
  }
}

function shuffleInPlace(items) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1)
    const tmp = items[i]
    items[i] = items[j]
    items[j] = tmp
  }
  return items
}

class ScopedFlashcardsDataSource {
  constructor(store, userId, request = null) {
    this.store = store
    this.userId = userId
    this.request = request
  }

  createFlashcard(data) {
    return this.store.createFlashcard(data, this.userId, this.request)
  }

  listFlashcards(filter = {}) {
    return this.store.listFlashcards(filter, this.userId)
  }

  readFlashcard(id) {
    return this.store.readFlashcard(id, this.userId)
  }

  updateFlashcard(id, data) {
    return this.store.updateFlashcard(id, data, this.userId, this.request)
  }

  deleteFlashcard(id) {
    return this.store.deleteFlashcard(id, this.userId, this.request)
  }

  drillFlashcards(options = {}) {
    return this.store.drillFlashcards(options, this.userId)
  }

  reviewFlashcard(id, rating) {
    return this.store.reviewFlashcard(id, rating, this.userId, this.request)
  }
}

module.exports = fp(
  async function flashcardsStorePlugin(fastify) {
    fastify.log.info('Starting registration of flashcards-store plugin')

    const flashcards = fastify.mongo.db.collection('flashcards')
    const notes = fastify.mongo.db.collection('notes')
    const folders = fastify.mongo.db.collection('folders')
    const syncTombstones = fastify.mongo.db.collection('syncTombstones')

    async function invalidateNoteCache(noteId, userId) {
      if (typeof fastify.cacheDelete !== 'function' || !noteId || !userId) {
        return
      }
      try {
        await fastify.cacheDelete(`note:${noteId}:${userId}`)
      } catch (err) {
        fastify.log.warn({ err, noteId, userId }, 'Failed to invalidate note cache key')
      }
    }

    async function resolveScopedNotes(
      { notebookId, folderId, noteId, includeExternal = true },
      userId,
    ) {
      if (noteId) {
        const note = await notes.findOne(
          { id: noteId, userId },
          { projection: { _id: 0, id: 1, title: 1, readiness: 1, notebookId: 1, folderId: 1 } },
        )
        if (!note) {
          throw fastify.httpErrors.notFound('Note not found')
        }
        const notesById = new Map([[note.id, new ScopedNoteNode(note, false)]])
        return notesById
      }

      await fastify.notebooksDataSource.verifyContainerFilter({ notebookId, folderId }, userId)

      let directFilter = { userId }
      if (folderId) {
        const targetFolder = await folders.findOne(
          { id: folderId, userId },
          { projection: { _id: 0, id: 1, notebookId: 1 } },
        )
        const allNbFolders = await folders
          .find(
            { userId, notebookId: targetFolder.notebookId },
            { projection: { _id: 0, id: 1, parentId: 1 } },
          )
          .toArray()
        const childrenByParent = new Map()
        for (const f of allNbFolders) {
          const pKey = f.parentId ?? null
          if (!childrenByParent.has(pKey)) childrenByParent.set(pKey, [])
          childrenByParent.get(pKey).push(f.id)
        }
        const subtreeFolderIds = []
        const stack = [folderId]
        const visited = new Set([folderId])
        while (stack.length > 0) {
          const curr = stack.pop()
          subtreeFolderIds.push(curr)
          for (const childId of childrenByParent.get(curr) || []) {
            if (!visited.has(childId)) {
              visited.add(childId)
              stack.push(childId)
            }
          }
        }
        directFilter = { userId, folderId: { $in: subtreeFolderIds } }
      } else if (notebookId) {
        directFilter = { userId, notebookId }
      }

      const directNotes = await notes
        .find(directFilter, {
          projection: {
            _id: 0,
            id: 1,
            title: 1,
            readiness: 1,
            notebookId: 1,
            folderId: 1,
            links: 1,
          },
        })
        .toArray()

      const notesById = new Map()
      const externalTargetIds = new Set()

      for (const n of directNotes) {
        notesById.set(n.id, new ScopedNoteNode(n, false))
      }

      const isContainerScoped = Boolean(notebookId || folderId)
      if (isContainerScoped && includeExternal !== false) {
        for (const n of directNotes) {
          if (Array.isArray(n.links)) {
            for (const link of n.links) {
              if (link?.targetId && !notesById.has(link.targetId)) {
                externalTargetIds.add(link.targetId)
              }
            }
          }
        }

        if (externalTargetIds.size > 0) {
          const externalNotes = await notes
            .find(
              { userId, id: { $in: Array.from(externalTargetIds) } },
              {
                projection: {
                  _id: 0,
                  id: 1,
                  title: 1,
                  readiness: 1,
                  notebookId: 1,
                  folderId: 1,
                },
              },
            )
            .toArray()

          for (const ext of externalNotes) {
            notesById.set(ext.id, new ScopedNoteNode(ext, true))
          }
        }
      }

      return notesById
    }

    const flashcardsDataSource = {
      async createFlashcard({ noteId, front, back }, userId, request = null) {
        const trimmedFront = typeof front === 'string' ? front.trim() : ''
        const trimmedBack = typeof back === 'string' ? back.trim() : ''
        if (!trimmedFront || !trimmedBack) {
          throw fastify.httpErrors.badRequest('Flashcard front and back cannot be blank')
        }

        const note = await notes.findOne({ id: noteId, userId }, { projection: { _id: 0, id: 1 } })
        if (!note) {
          throw fastify.httpErrors.notFound('Note not found')
        }

        const _id = randomUUIDv7()
        const now = instantToDate(nowInstant())
        const card = {
          _id,
          id: _id,
          userId,
          noteId,
          front: trimmedFront,
          back: trimmedBack,
          box: 1,
          nextReviewAt: now,
          lastReviewedAt: null,
          createdAt: now,
          modifiedAt: now,
        }

        await flashcards.insertOne(card)

        if (fastify.auditLog && request) {
          fastify.auditLog({
            request,
            action: 'flashcard_created',
            userId,
            resourceType: 'flashcard',
            resourceId: _id,
            details: { noteId },
          })
        }

        return normalizeFlashcardDoc(card)
      },

      async listFlashcards({ noteId, notebookId, folderId, box } = {}, userId) {
        const query = { userId }
        if (noteId) {
          query.noteId = noteId
        } else if (notebookId || folderId) {
          const scopedNotes = await resolveScopedNotes(
            { notebookId, folderId, includeExternal: true },
            userId,
          )
          query.noteId = { $in: Array.from(scopedNotes.keys()) }
        }
        if (box !== undefined) {
          query.box = Number(box)
        }

        const items = await flashcards
          .find(query, { projection: { _id: 0, userId: 0 } })
          .sort({ createdAt: 1, id: 1 })
          .toArray()

        return items.map(normalizeFlashcardDoc)
      },

      async readFlashcard(id, userId) {
        const card = await flashcards.findOne({ id, userId }, { projection: { _id: 0, userId: 0 } })
        if (!card) {
          throw fastify.httpErrors.notFound('Flashcard not found')
        }
        return normalizeFlashcardDoc(card)
      },

      async updateFlashcard(id, updateData, userId) {
        const updates = {
          modifiedAt: instantToDate(nowInstant()),
        }
        if (Object.hasOwn(updateData, 'front')) {
          const trimmedFront = typeof updateData.front === 'string' ? updateData.front.trim() : ''
          if (!trimmedFront) {
            throw fastify.httpErrors.badRequest('Flashcard front cannot be blank')
          }
          updates.front = trimmedFront
        }
        if (Object.hasOwn(updateData, 'back')) {
          const trimmedBack = typeof updateData.back === 'string' ? updateData.back.trim() : ''
          if (!trimmedBack) {
            throw fastify.httpErrors.badRequest('Flashcard back cannot be blank')
          }
          updates.back = trimmedBack
        }

        const result = await flashcards.findOneAndUpdate(
          { id, userId },
          { $set: updates },
          { returnDocument: 'after', projection: { _id: 0, userId: 0 } },
        )
        const updated = result?.value ?? result
        if (!updated) {
          throw fastify.httpErrors.notFound('Flashcard not found')
        }
        return normalizeFlashcardDoc(updated)
      },

      async deleteFlashcard(id, userId, request = null) {
        const deleteResult = await flashcards.findOneAndDelete({ id, userId })
        const deleted = deleteResult?.value ?? deleteResult
        if (!deleted) {
          throw fastify.httpErrors.notFound('Flashcard not found')
        }

        await syncTombstones.insertOne({
          _id: randomUUIDv7(),
          userId,
          entityType: 'flashcard',
          entityId: id,
          deletedAt: instantToDate(nowInstant()),
        })

        if (fastify.auditLog && request) {
          fastify.auditLog({
            request,
            action: 'flashcard_deleted',
            userId,
            resourceType: 'flashcard',
            resourceId: id,
          })
        }
      },

      async drillFlashcards(
        {
          notebookId,
          folderId,
          noteId,
          includeExternal = true,
          mode = 'scheduled',
          order = 'weakest_first',
          limit = 50,
        } = {},
        userId,
      ) {
        const scopedNotesById = await resolveScopedNotes(
          { notebookId, folderId, noteId, includeExternal },
          userId,
        )

        if (scopedNotesById.size === 0) {
          return []
        }

        const boundedLimit = Math.min(Math.max(Number(limit) || 50, 1), 200)
        const now = instantToDate(nowInstant())
        const query = {
          userId,
          noteId: { $in: Array.from(scopedNotesById.keys()) },
        }

        if (mode === 'scheduled') {
          query.nextReviewAt = { $lte: now }
        }

        const isShuffledCram = mode === 'cram_all' && order === 'shuffled'
        let sortSpec = { box: 1, nextReviewAt: 1, id: 1 }
        if (mode === 'cram_all' && order === 'sequential') {
          sortSpec = { createdAt: 1, id: 1 }
        }

        const cursor = flashcards.find(query, { projection: { _id: 0, userId: 0 } }).sort(sortSpec)

        if (!isShuffledCram) {
          cursor.limit(boundedLimit)
        }

        const rawCards = await cursor.toArray()

        if (isShuffledCram) {
          shuffleInPlace(rawCards)
        }

        const sliced = isShuffledCram ? rawCards.slice(0, boundedLimit) : rawCards
        const results = new Array(sliced.length)

        for (let i = 0; i < sliced.length; i += 1) {
          const card = sliced[i]
          const noteMeta = scopedNotesById.get(card.noteId)
          results[i] = {
            id: card.id,
            noteId: card.noteId,
            noteTitle: noteMeta ? noteMeta.title : '',
            noteReadiness: noteMeta ? noteMeta.readiness : 'to_review',
            isExternal: noteMeta ? noteMeta.isExternal : false,
            homeNotebookId: noteMeta ? noteMeta.notebookId : null,
            front: card.front,
            back: card.back,
            box: Number(card.box) || 1,
            nextReviewAt: card.nextReviewAt,
            lastReviewedAt: card.lastReviewedAt ?? null,
            createdAt: card.createdAt,
            modifiedAt: card.modifiedAt,
          }
        }

        return results
      },

      async reviewFlashcard(id, rating, userId) {
        const existingCard = await flashcards.findOne(
          { id, userId },
          { projection: { _id: 0, id: 1, noteId: 1, box: 1 } },
        )
        if (!existingCard) {
          throw fastify.httpErrors.notFound('Flashcard not found')
        }

        const now = instantToDate(nowInstant())
        const nowMs = now.getTime()
        const currentBox = Number(existingCard.box) || 1
        let nextBox
        let nextReviewAt

        if (rating === 'again') {
          nextBox = 1
          nextReviewAt = new Date(nowMs + 60 * 60 * 1000)
        } else if (rating === 'hard') {
          nextBox = currentBox
          const days = LEITNER_BOX_INTERVAL_DAYS[nextBox] || 1
          nextReviewAt = new Date(nowMs + days * 86_400_000)
        } else {
          nextBox = Math.min(5, currentBox + 1)
          const days = LEITNER_BOX_INTERVAL_DAYS[nextBox] || 1
          nextReviewAt = new Date(nowMs + days * 86_400_000)
        }

        const updateResult = await flashcards.findOneAndUpdate(
          { id, userId },
          {
            $set: {
              box: nextBox,
              nextReviewAt,
              lastReviewedAt: now,
              modifiedAt: now,
            },
          },
          { returnDocument: 'after', projection: { _id: 0, userId: 0 } },
        )
        const updatedCard = normalizeFlashcardDoc(updateResult?.value ?? updateResult)

        // Bidirectional parent Note readiness coupling
        const [noteCards, parentNote] = await Promise.all([
          flashcards
            .find({ userId, noteId: existingCard.noteId }, { projection: { _id: 0, box: 1 } })
            .toArray(),
          notes.findOne(
            { id: existingCard.noteId, userId },
            { projection: { _id: 0, id: 1, readiness: 1 } },
          ),
        ])

        let effectiveReadiness = parentNote?.readiness || 'to_review'
        if (parentNote && noteCards.length > 0) {
          const allHighRetention = noteCards.every((c) => (Number(c.box) || 1) >= 4)
          let targetReadiness = effectiveReadiness

          if (allHighRetention) {
            targetReadiness = 'mastered'
          } else if (rating === 'again' && effectiveReadiness === 'mastered') {
            targetReadiness = 'in_progress'
          } else if (effectiveReadiness === 'to_review') {
            targetReadiness = 'in_progress'
          }

          if (targetReadiness !== effectiveReadiness) {
            const noteUpdateResult = await notes.findOneAndUpdate(
              { id: existingCard.noteId, userId },
              {
                $set: {
                  readiness: targetReadiness,
                  modifiedAt: now,
                },
                $inc: { revision: 1 },
              },
              { returnDocument: 'after' },
            )
            const updatedParentNote = noteUpdateResult?.value ?? noteUpdateResult
            await invalidateNoteCache(existingCard.noteId, userId)
            effectiveReadiness = targetReadiness

            if (fastify.eventBus && updatedParentNote) {
              fastify.eventBus.emit(`note_updated:${existingCard.noteId}`, {
                type: 'NOTE_UPDATED',
                payload: {
                  id: updatedParentNote.id,
                  title: updatedParentNote.title,
                  body: typeof updatedParentNote.body === 'string' ? updatedParentNote.body : '',
                  tags: Array.isArray(updatedParentNote.tags) ? updatedParentNote.tags : [],
                  readiness: targetReadiness,
                  noteType: updatedParentNote.noteType || 'standard',
                  revision: updatedParentNote.revision,
                  modifiedAt: updatedParentNote.modifiedAt,
                },
              })
            }
          }
        }

        return {
          flashcard: updatedCard,
          noteReadiness: effectiveReadiness,
        }
      },

      forUser(userId, request = null) {
        return new ScopedFlashcardsDataSource(this, userId, request)
      },
    }

    fastify.decorate('flashcardsDataSource', flashcardsDataSource)
    fastify.decorateRequest('flashcardsDataSource', null)

    fastify.log.info('Successfully registered flashcards-store plugin')
  },
  {
    dependencies: ['db-plugin', 'notebooks-store', 'app-cache'],
    name: 'flashcards-store',
    decorators: {
      fastify: ['mongo', 'notebooksDataSource'],
    },
  },
)
