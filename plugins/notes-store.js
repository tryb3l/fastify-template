'use strict'

const fp = require('fastify-plugin')
const { randomUUIDv7 } = require('node:crypto')
const { instantToDate, nowInstant } = require('../utils/time')
const {
  NOTE_DETAIL_PROJECTION,
  NOTE_GRAPH_NODE_PROJECTION,
} = require('../routes/notes/query-shapes')

const NOTE_CACHE_TTL_MS = 300_000
const VALID_LINK_RELATIONS = new Set(['parent', 'child', 'related'])

const WIKI_LINK_REGEX =
  /\[\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\|([^\]]{1,100}))?\]\]/gi
const NOTE_URI_LINK_REGEX =
  /\[([^\]]{1,100})\]\(note:\/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi

const normalizeNoteBody = (body) => (typeof body === 'string' ? body : '')

const normalizePersistedNote = (note) => {
  const normalized = {
    ...note,
    body: normalizeNoteBody(note.body),
    notebookId: note.notebookId ?? null,
    folderId: note.folderId ?? null,
    links: Array.isArray(note.links) ? note.links : [],
  }
  delete normalized._id
  delete normalized.userId
  delete normalized.explicitLinks
  return normalized
}

function normalizeExplicitLinks(explicitLinks, selfNoteId = null) {
  const normalizedByTarget = new Map()
  if (!Array.isArray(explicitLinks)) {
    return []
  }

  for (const rawLink of explicitLinks) {
    if (!rawLink || typeof rawLink.targetId !== 'string') {
      continue
    }
    const targetId = rawLink.targetId.toLowerCase()
    if (selfNoteId && targetId === selfNoteId.toLowerCase()) {
      continue
    }
    const relation = VALID_LINK_RELATIONS.has(rawLink.relation) ? rawLink.relation : 'related'
    const normalizedLink = { targetId, relation }
    if (typeof rawLink.label === 'string' && rawLink.label.trim() !== '') {
      normalizedLink.label = rawLink.label.trim().slice(0, 100)
    }
    normalizedByTarget.set(targetId, normalizedLink)
  }

  return Array.from(normalizedByTarget.values())
}

function derivePreservedExplicitLinks(existingContext) {
  if (!existingContext) {
    return []
  }
  if (Array.isArray(existingContext.explicitLinks)) {
    return existingContext.explicitLinks
  }
  const existingLinks = Array.isArray(existingContext.links) ? existingContext.links : []
  if (existingLinks.length === 0) {
    return []
  }
  const oldMarkdownTargets = new Set(extractMarkdownLinks(existingContext.body).keys())
  return existingLinks.filter(
    (link) => !oldMarkdownTargets.has(link.targetId) || link.relation !== 'related',
  )
}

function buildNoteCacheKey(id, userId) {
  return `note:${id}:${userId}`
}

function extractMarkdownLinks(body) {
  const extracted = new Map()
  if (typeof body !== 'string' || body.length === 0) {
    return extracted
  }

  for (const match of body.matchAll(WIKI_LINK_REGEX)) {
    const targetId = match[1].toLowerCase()
    const label = match[2] ? match[2].trim() : null
    if (!extracted.has(targetId)) {
      const linkObj = { targetId, relation: 'related' }
      if (label) linkObj.label = label
      extracted.set(targetId, linkObj)
    }
  }

  for (const match of body.matchAll(NOTE_URI_LINK_REGEX)) {
    const label = match[1] ? match[1].trim() : null
    const targetId = match[2].toLowerCase()
    if (!extracted.has(targetId)) {
      const linkObj = { targetId, relation: 'related' }
      if (label) linkObj.label = label
      extracted.set(targetId, linkObj)
    }
  }

  return extracted
}

function mergeExplicitAndMarkdownLinks(explicitLinks, body, selfNoteId = null) {
  const mergedByTarget = new Map()
  const explicitTargetIds = new Set()

  if (Array.isArray(explicitLinks)) {
    for (const rawLink of explicitLinks) {
      if (!rawLink || typeof rawLink.targetId !== 'string') {
        continue
      }
      const targetId = rawLink.targetId.toLowerCase()
      if (selfNoteId && targetId === selfNoteId.toLowerCase()) {
        continue
      }
      const relation = VALID_LINK_RELATIONS.has(rawLink.relation) ? rawLink.relation : 'related'
      const normalizedLink = { targetId, relation }
      if (typeof rawLink.label === 'string' && rawLink.label.trim() !== '') {
        normalizedLink.label = rawLink.label.trim().slice(0, 100)
      }
      mergedByTarget.set(targetId, normalizedLink)
      explicitTargetIds.add(targetId)
    }
  }

  const markdownMap = extractMarkdownLinks(body)
  const markdownTargetIds = new Set(markdownMap.keys())
  const markdownOnlyTargets = markdownTargetIds.difference(explicitTargetIds)

  for (const targetId of markdownOnlyTargets) {
    if (selfNoteId && targetId === selfNoteId.toLowerCase()) {
      continue
    }
    mergedByTarget.set(targetId, markdownMap.get(targetId))
  }

  return Array.from(mergedByTarget.values())
}

class ScopedNotesDataSource {
  constructor(store, userId, request = null) {
    this.store = store
    this.userId = userId
    this.request = request
  }

  countNotes(filter = {}) {
    return this.store.countNotes(filter, this.userId)
  }

  listNotes(options = {}) {
    return this.store.listNotes(options, this.userId)
  }

  createNote(data) {
    return this.store.createNote(data, this.userId, this.request)
  }

  createNotes(noteList, options = {}) {
    return this.store.createNotes(noteList, this.userId, options)
  }

  readNote(id, projection = {}) {
    return this.store.readNote(id, this.userId, projection)
  }

  updateNote(id, newNote) {
    return this.store.updateNote(id, newNote, this.userId, this.request)
  }

  deleteNote(id, expectedRevision) {
    return this.store.deleteNote(id, this.userId, expectedRevision, this.request)
  }

  addAttachments(id, attachments) {
    return this.store.addAttachments(id, attachments, this.userId)
  }

  listBacklinks(noteId) {
    return this.store.listBacklinks(noteId, this.userId)
  }

  getMindMapGraph(options = {}) {
    return this.store.getMindMapGraph(options, this.userId)
  }
}

module.exports = fp(
  async function notesStorePlugin(fastify) {
    fastify.log.info('Starting registration of notes-store plugin')

    const notes = fastify.mongo.db.collection('notes')

    async function invalidateNoteCache(noteId, userId) {
      if (typeof fastify.cacheDelete !== 'function' || !noteId || !userId) {
        return
      }
      try {
        await fastify.cacheDelete(buildNoteCacheKey(noteId, userId))
      } catch (err) {
        fastify.log.warn({ err, noteId, userId }, 'Failed to invalidate note cache key')
      }
    }

    async function verifyTargetNoteIdsExist(links, userId) {
      if (!Array.isArray(links) || links.length === 0) {
        return
      }

      const requestedIds = new Set(links.map((link) => link.targetId))
      const foundNotes = await notes
        .find({ userId, id: { $in: Array.from(requestedIds) } }, { projection: { _id: 0, id: 1 } })
        .toArray()

      const ownedIds = new Set(foundNotes.map((n) => n.id))
      const missingIds = requestedIds.difference(ownedIds)

      if (missingIds.size > 0) {
        throw fastify.httpErrors.notFound('Target note not found for one or more links')
      }
    }

    const notesDataSource = {
      _buildFilter(rawFilter = {}, userId) {
        const finalFilter = { userId }
        if (rawFilter.title) {
          finalFilter.title = new RegExp(rawFilter.title, 'i')
        }
        if (Object.hasOwn(rawFilter, 'notebookId') && rawFilter.notebookId !== undefined) {
          finalFilter.notebookId = rawFilter.notebookId
        }
        if (Object.hasOwn(rawFilter, 'folderId') && rawFilter.folderId !== undefined) {
          finalFilter.folderId = rawFilter.folderId
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
        const items = await cursor.toArray()
        fastify.log.info('Exiting listNotes method')
        return items.map((item) => ({
          ...item,
          ...(Object.hasOwn(projection, 'notebookId')
            ? { notebookId: item.notebookId ?? null }
            : {}),
          ...(Object.hasOwn(projection, 'folderId') ? { folderId: item.folderId ?? null } : {}),
        }))
      },

      async createNote(
        { title, body, tags, notebookId = null, folderId = null, links },
        userId,
        request = null,
      ) {
        fastify.log.info('Entering createNote method')

        let verifiedPlacement = { notebookId: null, folderId: null }
        if (
          (notebookId !== null && notebookId !== undefined) ||
          (folderId !== null && folderId !== undefined)
        ) {
          verifiedPlacement = await fastify.notebooksDataSource.verifyContainerPlacement(
            { notebookId, folderId },
            userId,
          )
        }

        const _id = randomUUIDv7()
        const normalizedBody = normalizeNoteBody(body)
        const normalizedExplicit = normalizeExplicitLinks(links, _id)
        const resolvedLinks = mergeExplicitAndMarkdownLinks(normalizedExplicit, normalizedBody, _id)

        if (resolvedLinks.length > 0) {
          await verifyTargetNoteIdsExist(resolvedLinks, userId)
        }

        const now = instantToDate(nowInstant())
        const note = {
          _id,
          userId,
          title,
          body: normalizedBody,
          tags,
          notebookId: verifiedPlacement.notebookId,
          folderId: verifiedPlacement.folderId,
          explicitLinks: normalizedExplicit,
          links: resolvedLinks,
          attachments: [],
          id: _id,
          revision: 1,
          createdAt: now,
          modifiedAt: now,
        }
        await notes.insertOne(note)

        if (fastify.auditLog && request) {
          fastify.auditLog({
            request,
            action: 'note_created',
            userId,
            resourceType: 'note',
            resourceId: _id,
          })
        }

        fastify.log.info('Exiting createNote method')
        return normalizePersistedNote(note)
      },

      async createNotes(noteList, userId, options = {}) {
        fastify.log.info('Entering createNotes method')

        const targetNotebookId = options.notebookId ?? null
        const targetFolderId = options.folderId ?? null

        const now = instantToDate(nowInstant())
        const batchNoteIds = new Set()
        const allCandidateLinks = []

        const toInsert = noteList.map((rawNote) => {
          const _id = randomUUIDv7()
          batchNoteIds.add(_id)
          const normalizedBody = normalizeNoteBody(rawNote.body)
          const normalizedExplicit = normalizeExplicitLinks(rawNote.links, _id)
          const resolvedLinks = mergeExplicitAndMarkdownLinks(
            normalizedExplicit,
            normalizedBody,
            _id,
          )
          allCandidateLinks.push(...resolvedLinks)

          return {
            _id,
            userId,
            ...rawNote,
            body: normalizedBody,
            notebookId: targetNotebookId,
            folderId: targetFolderId,
            explicitLinks: normalizedExplicit,
            links: resolvedLinks,
            attachments: rawNote.attachments || [],
            id: _id,
            revision: 1,
            createdAt: now,
            modifiedAt: now,
          }
        })

        const externalLinks = allCandidateLinks.filter((link) => !batchNoteIds.has(link.targetId))
        if (externalLinks.length > 0) {
          await verifyTargetNoteIdsExist(externalLinks, userId)
        }

        await notes.insertMany(toInsert)
        fastify.log.info('Exiting createNotes method')
        return toInsert.map((note) => note._id)
      },

      async readNote(id, userId, projection = {}) {
        fastify.log.info('Entering readNote method')
        const useCache =
          Object.keys(projection).length === 0 && typeof fastify.cacheGet === 'function'
        const cacheKey = useCache ? buildNoteCacheKey(id, userId) : null

        if (useCache) {
          const cached = await fastify.cacheGet(cacheKey)
          if (cached && cached.item) {
            fastify.log.info('Cache HIT - Serving from RAM')
            return cached.item
          }
        }

        const note = await notes.findOne(
          { id: id, userId: userId },
          {
            projection: {
              ...NOTE_DETAIL_PROJECTION,
              ...projection,
            },
          },
        )
        if (!note) {
          fastify.log.info(`Note not found for ID: ${id} and User ID: ${userId}`)
          throw fastify.httpErrors.notFound('Note not found')
        }

        const normalized = normalizePersistedNote(note)
        if (useCache && typeof fastify.cacheSet === 'function') {
          await fastify.cacheSet(cacheKey, normalized, NOTE_CACHE_TTL_MS)
        }

        fastify.log.info('Exiting readNote method')
        return normalized
      },

      async updateNote(id, newNote, userId, request = null) {
        const { expectedRevision, ...rawUpdate } = newNote
        const normalizedUpdate = {
          ...rawUpdate,
        }

        const hasBodyUpdate = Object.hasOwn(normalizedUpdate, 'body')
        if (hasBodyUpdate) {
          normalizedUpdate.body = normalizeNoteBody(normalizedUpdate.body)
        }

        const hasNotebookUpdate = Object.hasOwn(normalizedUpdate, 'notebookId')
        const hasFolderUpdate = Object.hasOwn(normalizedUpdate, 'folderId')
        const hasLinksUpdate = Object.hasOwn(normalizedUpdate, 'links')

        let existingContext = null
        if (
          (hasNotebookUpdate && !hasFolderUpdate && normalizedUpdate.notebookId !== null) ||
          (!hasNotebookUpdate && hasFolderUpdate) ||
          (hasBodyUpdate && !hasLinksUpdate) ||
          (hasLinksUpdate && !hasBodyUpdate)
        ) {
          existingContext = await notes.findOne(
            { id, userId },
            {
              projection: {
                _id: 0,
                notebookId: 1,
                folderId: 1,
                body: 1,
                links: 1,
                explicitLinks: 1,
              },
            },
          )
          if (!existingContext) {
            throw fastify.httpErrors.notFound('Note not found')
          }
        }

        if (hasNotebookUpdate || hasFolderUpdate) {
          const targetNotebookId = hasNotebookUpdate
            ? normalizedUpdate.notebookId
            : (existingContext?.notebookId ?? null)
          const targetFolderId = hasFolderUpdate
            ? normalizedUpdate.folderId
            : targetNotebookId === null
              ? null
              : targetNotebookId !== (existingContext?.notebookId ?? null)
                ? null
                : (existingContext?.folderId ?? null)

          const verifiedPlacement = await fastify.notebooksDataSource.verifyContainerPlacement(
            { notebookId: targetNotebookId, folderId: targetFolderId },
            userId,
          )
          normalizedUpdate.notebookId = verifiedPlacement.notebookId
          normalizedUpdate.folderId = verifiedPlacement.folderId
        }

        if (hasLinksUpdate || hasBodyUpdate) {
          const effectiveBody = hasBodyUpdate
            ? normalizedUpdate.body
            : normalizeNoteBody(existingContext?.body)
          const effectiveExplicitLinks = hasLinksUpdate
            ? normalizeExplicitLinks(normalizedUpdate.links, id)
            : derivePreservedExplicitLinks(existingContext)

          const mergedLinks = mergeExplicitAndMarkdownLinks(
            effectiveExplicitLinks,
            effectiveBody,
            id,
          )

          const previousTargetIds = new Set(
            (existingContext?.links || []).map((link) => link.targetId),
          )
          const unverifiedLinks = mergedLinks.filter(
            (link) => !previousTargetIds.has(link.targetId),
          )
          if (unverifiedLinks.length > 0) {
            await verifyTargetNoteIdsExist(unverifiedLinks, userId)
          }

          normalizedUpdate.explicitLinks = effectiveExplicitLinks
          normalizedUpdate.links = mergedLinks
        }

        const result = await notes.findOneAndUpdate(
          { id, userId, revision: expectedRevision },
          {
            $set: {
              ...normalizedUpdate,
              modifiedAt: instantToDate(nowInstant()),
            },
            $inc: { revision: 1 },
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
                revision: 1,
                modifiedAt: 1,
              },
            },
          )

          if (!existingNote) {
            throw fastify.httpErrors.notFound('Note not found')
          }

          const conflictError = fastify.httpErrors.conflict(
            'Note was modified elsewhere. Reload the latest note before saving again.',
          )
          conflictError.conflictCode = 'NOTE_STALE_SAVE'
          conflictError.currentRevision = existingNote.revision
          conflictError.currentModifiedAt = existingNote.modifiedAt
          throw conflictError
        }

        const normalized = normalizePersistedNote(updatedNote)

        await invalidateNoteCache(id, userId)

        if (fastify.auditLog) {
          fastify.auditLog({
            request,
            action: 'note_updated',
            userId,
            resourceType: 'note',
            resourceId: id,
          })
        }

        if (fastify.eventBus) {
          const sanitizedEventDTO = {
            id: normalized.id,
            title: normalized.title,
            body: normalized.body,
            tags: normalized.tags,
            revision: normalized.revision,
            modifiedAt: normalized.modifiedAt,
          }
          fastify.eventBus.emit(`note_updated:${id}`, {
            type: 'NOTE_UPDATED',
            payload: sanitizedEventDTO,
          })
        }

        return normalized
      },

      async deleteNote(id, userId, expectedRevision, request = null) {
        fastify.log.info('Entering deleteNote method')
        const deleteResult = await notes.findOneAndDelete({
          id,
          userId,
          revision: expectedRevision,
        })

        const deletedNote = deleteResult?.value ?? deleteResult

        if (!deletedNote) {
          const existingNote = await notes.findOne(
            { id, userId },
            {
              projection: {
                _id: 0,
                revision: 1,
                modifiedAt: 1,
              },
            },
          )

          if (!existingNote) {
            fastify.log.info(`Note not found for ID: ${id} and User ID: ${userId}`)
            throw fastify.httpErrors.notFound('Note not found')
          }

          const conflictError = fastify.httpErrors.conflict(
            'Note was modified elsewhere. Reload the latest note before deleting.',
          )
          conflictError.conflictCode = 'NOTE_STALE_DELETE'
          conflictError.currentRevision = existingNote.revision
          conflictError.currentModifiedAt = existingNote.modifiedAt
          throw conflictError
        }

        await invalidateNoteCache(id, userId)

        // Clean up any incoming links from other notes of the same user
        const referencingNotes = await notes
          .find({ userId, 'links.targetId': id }, { projection: { _id: 0, id: 1 } })
          .toArray()

        if (referencingNotes.length > 0) {
          await notes.updateMany(
            { userId, 'links.targetId': id },
            {
              $pull: {
                links: { targetId: id },
                explicitLinks: { targetId: id },
              },
            },
          )
          await Promise.all(
            referencingNotes.map((refNote) => invalidateNoteCache(refNote.id, userId)),
          )
        }

        // Clean up any disk attachment blobs belonging to the deleted note
        if (
          fastify.notesFileManager &&
          Array.isArray(deletedNote.attachments) &&
          deletedNote.attachments.length > 0
        ) {
          await fastify.notesFileManager.deleteNoteAttachments(deletedNote.attachments)
        }

        if (fastify.auditLog) {
          fastify.auditLog({
            request,
            action: 'note_deleted',
            userId,
            resourceType: 'note',
            resourceId: id,
          })
        }

        fastify.log.info('Exiting deleteNote method')
      },

      async addAttachments(id, attachments, userId) {
        const result = await notes.findOneAndUpdate(
          { id, userId },
          {
            $push: { attachments: { $each: attachments } },
            $set: { modifiedAt: instantToDate(nowInstant()) },
          },
          { returnDocument: 'after' },
        )

        const updatedNote = result?.value ?? result

        if (!updatedNote) {
          throw fastify.httpErrors.notFound('Note not found')
        }

        await invalidateNoteCache(id, userId)

        return normalizePersistedNote(updatedNote)
      },

      async listBacklinks(noteId, userId) {
        await this.readNote(noteId, userId, { id: 1 })

        const incomingNotes = await notes
          .find({ userId, 'links.targetId': noteId }, { projection: NOTE_GRAPH_NODE_PROJECTION })
          .sort({ modifiedAt: -1 })
          .toArray()

        return incomingNotes.map((sourceNote) => {
          const matchingLink = (sourceNote.links || []).find((link) => link.targetId === noteId)
          return {
            sourceId: sourceNote.id,
            title: sourceNote.title,
            notebookId: sourceNote.notebookId ?? null,
            folderId: sourceNote.folderId ?? null,
            relation: matchingLink?.relation || 'related',
            ...(matchingLink?.label ? { label: matchingLink.label } : {}),
            modifiedAt: sourceNote.modifiedAt,
          }
        })
      },

      async getMindMapGraph({ rootNoteId, notebookId, folderId, maxDepth = 3 } = {}, userId) {
        const boundedDepth = Math.min(Math.max(Number(maxDepth) || 3, 1), 5)

        await fastify.notebooksDataSource.verifyContainerFilter({ notebookId, folderId }, userId)

        const containerFilter = { userId }
        if (notebookId !== undefined) {
          containerFilter.notebookId = notebookId
        }
        if (folderId !== undefined) {
          containerFilter.folderId = folderId
        }

        let rawNodes

        if (rootNoteId) {
          const [traversalResult, incomingBacklinkNotes] = await Promise.all([
            notes
              .aggregate([
                { $match: { ...containerFilter, id: rootNoteId } },
                {
                  $graphLookup: {
                    from: 'notes',
                    startWith: '$links.targetId',
                    connectFromField: 'links.targetId',
                    connectToField: 'id',
                    as: 'descendants',
                    maxDepth: Math.max(0, boundedDepth - 1),
                    depthField: 'hopDepth',
                    restrictSearchWithMatch: containerFilter,
                  },
                },
                {
                  $project: {
                    _id: 0,
                    root: {
                      id: '$id',
                      title: '$title',
                      tags: '$tags',
                      notebookId: '$notebookId',
                      folderId: '$folderId',
                      links: '$links',
                      modifiedAt: '$modifiedAt',
                    },
                    descendants: {
                      $map: {
                        input: '$descendants',
                        as: 'd',
                        in: {
                          id: '$$d.id',
                          title: '$$d.title',
                          tags: '$$d.tags',
                          notebookId: '$$d.notebookId',
                          folderId: '$$d.folderId',
                          links: '$$d.links',
                          modifiedAt: '$$d.modifiedAt',
                        },
                      },
                    },
                  },
                },
              ])
              .toArray(),
            notes
              .find(
                { ...containerFilter, 'links.targetId': rootNoteId },
                { projection: NOTE_GRAPH_NODE_PROJECTION },
              )
              .toArray(),
          ])

          if (!traversalResult.length || !traversalResult[0].root?.id) {
            throw fastify.httpErrors.notFound('Note not found')
          }

          const { root, descendants = [] } = traversalResult[0]
          rawNodes = [root, ...descendants, ...incomingBacklinkNotes]
        } else {
          rawNodes = await notes
            .find(containerFilter, { projection: NOTE_GRAPH_NODE_PROJECTION })
            .sort({ modifiedAt: -1 })
            .toArray()
        }

        const nodeMap = new Map()
        for (const n of rawNodes) {
          if (!n || !n.id || nodeMap.has(n.id)) continue
          nodeMap.set(n.id, {
            id: n.id,
            title: n.title,
            tags: Array.isArray(n.tags) ? n.tags : [],
            notebookId: n.notebookId ?? null,
            folderId: n.folderId ?? null,
            modifiedAt: n.modifiedAt,
            _links: Array.isArray(n.links) ? n.links : [],
          })
        }

        const nodeIdSet = new Set(nodeMap.keys())
        const edges = []
        const seenEdges = new Set()

        for (const node of nodeMap.values()) {
          for (const link of node._links) {
            if (!link || !link.targetId || !nodeIdSet.has(link.targetId)) {
              continue
            }
            const edgeKey = `${node.id}->${link.targetId}:${link.relation || 'related'}`
            if (seenEdges.has(edgeKey)) {
              continue
            }
            seenEdges.add(edgeKey)
            const edge = {
              sourceId: node.id,
              targetId: link.targetId,
              relation: link.relation || 'related',
            }
            if (link.label) {
              edge.label = link.label
            }
            edges.push(edge)
          }
        }

        const publicNodes = Array.from(nodeMap.values(), (node) => ({
          id: node.id,
          title: node.title,
          tags: node.tags,
          notebookId: node.notebookId,
          folderId: node.folderId,
          modifiedAt: node.modifiedAt,
        }))

        return {
          nodes: publicNodes,
          edges,
        }
      },

      forUser(userId, request = null) {
        return new ScopedNotesDataSource(this, userId, request)
      },
    }

    fastify.decorate('notesDataSource', notesDataSource)
    fastify.decorateRequest('notesDataSource', null)
    fastify.decorate('bindScopedDataSources', async function bindScopedDataSources(request) {
      const userId = request.user?._id || request.user?.id
      if (userId) {
        request.notesDataSource = fastify.notesDataSource.forUser(userId, request)
        request.notebooksDataSource = fastify.notebooksDataSource.forUser(userId, request)
      }
    })
    fastify.log.info('Successfully registered notes-store plugin')
  },
  {
    dependencies: ['db-plugin', 'notebooks-store', 'notes-file-manager', 'app-cache'],
    name: 'notes-store',
    decorators: {
      fastify: ['mongo', 'notebooksDataSource', 'notesFileManager'],
    },
  },
)
