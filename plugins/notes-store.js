'use strict'

const fp = require('fastify-plugin')
const { randomUUIDv7 } = require('node:crypto')
const { instantToDate, nowInstant, nowIsoInstantString } = require('../utils/time')
const {
  NOTE_DETAIL_PROJECTION,
  NOTE_GRAPH_NODE_PROJECTION,
  NOTE_READINESS_VALUES,
  NOTE_TYPES,
} = require('../routes/notes/query-shapes')

const NOTE_CACHE_TTL_MS = 300_000
const SYNC_TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const SYNC_DEFAULT_BATCH_LIMIT = 500
const SYNC_MAX_BATCH_LIMIT = 1_000
const SYNC_CURSOR_KEYS = ['notes', 'notebooks', 'folders', 'flashcards', 'tombstones']

function decodeSyncCursor(rawCursor, sinceMs, nowMs, fastify) {
  if (!rawCursor) {
    return null
  }

  let parsed
  try {
    parsed = JSON.parse(Buffer.from(String(rawCursor), 'base64url').toString('utf8'))
  } catch {
    throw fastify.httpErrors.badRequest('Invalid sync cursor')
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    parsed.v !== 1 ||
    typeof parsed.t0 !== 'number' ||
    !Number.isFinite(parsed.t0) ||
    !parsed.s ||
    typeof parsed.s !== 'object'
  ) {
    throw fastify.httpErrors.badRequest('Invalid sync cursor')
  }

  if (nowMs - parsed.t0 > SYNC_TOMBSTONE_TTL_MS || parsed.t0 > nowMs + 60_000) {
    const goneErr = fastify.httpErrors.gone('Sync cursor expired; perform a full sync')
    goneErr.syncCode = 'SYNC_CURSOR_EXPIRED'
    throw goneErr
  }

  for (const key of SYNC_CURSOR_KEYS) {
    const state = parsed.s[key]
    if (!state || typeof state !== 'object' || typeof state.done !== 'boolean') {
      throw fastify.httpErrors.badRequest('Invalid sync cursor')
    }
    if (state.done !== true) {
      if (
        typeof state.ts !== 'number' ||
        !Number.isFinite(state.ts) ||
        state.ts < sinceMs ||
        typeof state.id !== 'string' ||
        state.id.length === 0 ||
        state.id.length > 128
      ) {
        throw fastify.httpErrors.badRequest('Invalid sync cursor')
      }
      if (nowMs - state.ts > SYNC_TOMBSTONE_TTL_MS || state.ts > nowMs + 60_000) {
        const goneErr = fastify.httpErrors.gone('Sync cursor expired; perform a full sync')
        goneErr.syncCode = 'SYNC_CURSOR_EXPIRED'
        throw goneErr
      }
    }
  }

  return parsed
}

function encodeSyncCursor(t0, states) {
  return Buffer.from(JSON.stringify({ v: 1, t0, s: states }), 'utf8').toString('base64url')
}

function buildSyncCollectionQuery(userId, sinceDate, cursorEntry, tsField, idField) {
  if (!cursorEntry) {
    return { userId, [tsField]: { $gte: sinceDate } }
  }
  if (cursorEntry.done === true) {
    return null
  }
  const boundaryDate = new Date(cursorEntry.ts)
  return {
    userId,
    $or: [
      { [tsField]: { $gt: boundaryDate } },
      { [tsField]: boundaryDate, [idField]: { $gt: cursorEntry.id } },
    ],
  }
}

function sliceSyncBatch(items, limit, tsField, idField) {
  if (items.length <= limit) {
    return {
      sliced: items,
      overflow: false,
      nextState: { done: true, ts: 0, id: '' },
      overflowTimestampMs: Infinity,
    }
  }

  const sliced = items.slice(0, limit)
  const lastIncluded = sliced[limit - 1]
  const firstOverflow = items[limit]
  const lastTs =
    lastIncluded[tsField] instanceof Date
      ? lastIncluded[tsField].getTime()
      : Date.parse(lastIncluded[tsField])
  const overflowTs =
    firstOverflow[tsField] instanceof Date
      ? firstOverflow[tsField].getTime()
      : Date.parse(firstOverflow[tsField])

  return {
    sliced,
    overflow: true,
    nextState: { done: false, ts: lastTs, id: String(lastIncluded[idField]) },
    overflowTimestampMs: overflowTs,
  }
}
const VALID_LINK_RELATIONS = new Set(['parent', 'child', 'related'])
const VALID_READINESS_SET = new Set(
  NOTE_READINESS_VALUES || ['to_review', 'in_progress', 'mastered'],
)
const VALID_NOTE_TYPES_SET = new Set(NOTE_TYPES || ['standard', 'post_mortem'])

function areStringArraysEqual(a, b) {
  const arrA = Array.isArray(a) ? a : []
  const arrB = Array.isArray(b) ? b : []
  if (arrA.length !== arrB.length) return false
  for (let i = 0; i < arrA.length; i += 1) {
    if (arrA[i] !== arrB[i]) return false
  }
  return true
}

function areLinksEqual(a, b) {
  const arrA = Array.isArray(a) ? a : []
  const arrB = Array.isArray(b) ? b : []
  if (arrA.length !== arrB.length) return false
  for (let i = 0; i < arrA.length; i += 1) {
    const linkA = arrA[i]
    const linkB = arrB[i]
    if (
      linkA.targetId !== linkB.targetId ||
      linkA.relation !== linkB.relation ||
      (linkA.label ?? undefined) !== (linkB.label ?? undefined)
    ) {
      return false
    }
  }
  return true
}

const WIKI_LINK_REGEX =
  /\[\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\|([^[\]\r\n]{1,100}))?\]\]/gi
const NOTE_URI_LINK_REGEX =
  /\[([^[\]\r\n]{1,100})\]\(note:\/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi

const normalizeNoteBody = (body) => (typeof body === 'string' ? body : '')

const normalizePersistedNote = (note) => ({
  id: note.id,
  revision: Number(note.revision) || 1,
  title: note.title,
  body: normalizeNoteBody(note.body),
  tags: Array.isArray(note.tags) ? note.tags : [],
  readiness: VALID_READINESS_SET.has(note.readiness) ? note.readiness : 'to_review',
  noteType: VALID_NOTE_TYPES_SET.has(note.noteType) ? note.noteType : 'standard',
  notebookId: note.notebookId ?? null,
  folderId: note.folderId ?? null,
  links: Array.isArray(note.links) ? note.links : [],
  attachments: Array.isArray(note.attachments) ? note.attachments : [],
  createdAt: note.createdAt,
  modifiedAt: note.modifiedAt,
})

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

  removeAttachment(id, fileId) {
    return this.store.removeAttachment(id, fileId, this.userId)
  }

  getUserStorageUsageBytes() {
    return this.store.getUserStorageUsageBytes(this.userId)
  }

  listBacklinks(noteId) {
    return this.store.listBacklinks(noteId, this.userId)
  }

  getMindMapGraph(options = {}) {
    return this.store.getMindMapGraph(options, this.userId)
  }

  getWorkspaceSyncDelta(since, options = {}) {
    return this.store.getWorkspaceSyncDelta(since, this.userId, options)
  }
}

const notesStorePlugin = fp(
  async function notesStorePlugin(fastify) {
    fastify.log.info('Starting registration of notes-store plugin')

    const notes = fastify.mongo.db.collection('notes')
    const notebooks = fastify.mongo.db.collection('notebooks')
    const folders = fastify.mongo.db.collection('folders')
    const flashcards = fastify.mongo.db.collection('flashcards')
    const syncTombstones = fastify.mongo.db.collection('syncTombstones')

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
        if (typeof rawFilter.title === 'string' && rawFilter.title.length > 0) {
          const needle = rawFilter.title.toLowerCase()
          finalFilter.$expr = {
            $gte: [
              {
                $indexOfCP: [{ $toLower: { $ifNull: ['$title', ''] } }, { $literal: needle }],
              },
              0,
            ],
          }
        }
        if (rawFilter.readiness && VALID_READINESS_SET.has(rawFilter.readiness)) {
          finalFilter.readiness =
            rawFilter.readiness === 'to_review' ? { $in: ['to_review', null] } : rawFilter.readiness
        }
        if (rawFilter.noteType && VALID_NOTE_TYPES_SET.has(rawFilter.noteType)) {
          finalFilter.noteType =
            rawFilter.noteType === 'standard' ? { $in: ['standard', null] } : rawFilter.noteType
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
        fastify.log.debug('Entering countNotes method')
        const finalFilter = this._buildFilter(filter, userId)
        const totalCount = await notes.countDocuments(finalFilter)
        fastify.log.debug('Exiting countNotes method')
        return totalCount
      },

      async listNotes(
        { filter = {}, projection = {}, skip = 0, limit = 50, asStream = false } = {},
        userId,
      ) {
        fastify.log.debug('Entering listNotes method')
        const finalFilter = this._buildFilter(filter, userId)

        const cursor = notes
          .find(finalFilter, {
            projection: { ...projection, _id: 0 },
            limit,
            skip,
          })
          .sort({ modifiedAt: -1 })
        if (asStream) {
          fastify.log.debug('Exiting listNotes method with stream')
          return cursor.stream()
        }
        const items = await cursor.toArray()
        fastify.log.debug('Exiting listNotes method')
        return items.map((item) => ({
          ...item,
          ...(Object.hasOwn(projection, 'readiness')
            ? {
                readiness: VALID_READINESS_SET.has(item.readiness) ? item.readiness : 'to_review',
              }
            : {}),
          ...(Object.hasOwn(projection, 'noteType')
            ? {
                noteType: VALID_NOTE_TYPES_SET.has(item.noteType) ? item.noteType : 'standard',
              }
            : {}),
          ...(Object.hasOwn(projection, 'notebookId')
            ? { notebookId: item.notebookId ?? null }
            : {}),
          ...(Object.hasOwn(projection, 'folderId') ? { folderId: item.folderId ?? null } : {}),
        }))
      },

      async createNote(
        {
          title,
          body,
          tags,
          readiness = 'to_review',
          noteType = 'standard',
          notebookId = null,
          folderId = null,
          links,
        },
        userId,
        request = null,
      ) {
        fastify.log.debug('Entering createNote method')

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

        const normalizedReadiness = VALID_READINESS_SET.has(readiness) ? readiness : 'to_review'
        const normalizedNoteType = VALID_NOTE_TYPES_SET.has(noteType) ? noteType : 'standard'

        const now = instantToDate(nowInstant())
        const note = {
          _id,
          userId,
          title,
          body: normalizedBody,
          tags,
          readiness: normalizedReadiness,
          noteType: normalizedNoteType,
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
        if (typeof fastify.recordDailyActivity === 'function') {
          await Promise.all([
            notes.insertOne(note),
            fastify.recordDailyActivity(
              userId,
              {
                notesCreated: 1,
                postMortemsCreated: normalizedNoteType === 'post_mortem' ? 1 : 0,
              },
              now,
            ),
          ])
        } else {
          await notes.insertOne(note)
        }

        if (fastify.auditLog && request) {
          fastify.auditLog({
            request,
            action: 'note_created',
            userId,
            resourceType: 'note',
            resourceId: _id,
          })
        }

        fastify.log.debug('Exiting createNote method')
        return normalizePersistedNote(note)
      },

      async createNotes(noteList, userId, options = {}) {
        fastify.log.debug('Entering createNotes method')

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
            readiness: VALID_READINESS_SET.has(rawNote.readiness) ? rawNote.readiness : 'to_review',
            noteType: VALID_NOTE_TYPES_SET.has(rawNote.noteType) ? rawNote.noteType : 'standard',
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

        if (typeof fastify.recordDailyActivity === 'function' && toInsert.length > 0) {
          let postMortemsCount = 0
          for (let i = 0; i < toInsert.length; i += 1) {
            if (toInsert[i].noteType === 'post_mortem') {
              postMortemsCount += 1
            }
          }
          await Promise.all([
            notes.insertMany(toInsert),
            fastify.recordDailyActivity(
              userId,
              {
                notesCreated: toInsert.length,
                postMortemsCreated: postMortemsCount,
              },
              now,
            ),
          ])
        } else {
          await notes.insertMany(toInsert)
        }

        fastify.log.debug('Exiting createNotes method')
        return toInsert.map((note) => note._id)
      },

      async readNote(id, userId, projection = {}) {
        fastify.log.debug('Entering readNote method')
        const useCache =
          Object.keys(projection).length === 0 && typeof fastify.cacheGet === 'function'
        const cacheKey = useCache ? buildNoteCacheKey(id, userId) : null

        if (useCache) {
          const cached = await fastify.cacheGet(cacheKey)
          if (cached && cached.item) {
            fastify.log.debug('Cache HIT - Serving from RAM')
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
          fastify.log.debug(`Note not found for ID: ${id} and User ID: ${userId}`)
          throw fastify.httpErrors.notFound('Note not found')
        }

        const normalized = normalizePersistedNote(note)
        if (useCache && typeof fastify.cacheSet === 'function') {
          await fastify.cacheSet(cacheKey, normalized, NOTE_CACHE_TTL_MS)
        }

        fastify.log.debug('Exiting readNote method')
        return normalized
      },

      async updateNote(id, newNote, userId) {
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

        const existingContext = await notes.findOne(
          { id, userId },
          {
            projection: {
              ...NOTE_DETAIL_PROJECTION,
              explicitLinks: 1,
            },
          },
        )
        if (!existingContext) {
          throw fastify.httpErrors.notFound('Note not found')
        }

        if (existingContext.revision !== expectedRevision) {
          const conflictError = fastify.httpErrors.conflict(
            'Note was modified elsewhere. Reload the latest note before saving again.',
          )
          conflictError.conflictCode = 'NOTE_STALE_SAVE'
          conflictError.currentRevision = existingContext.revision
          conflictError.currentModifiedAt = existingContext.modifiedAt
          throw conflictError
        }

        if (hasNotebookUpdate || hasFolderUpdate) {
          const targetNotebookId = hasNotebookUpdate
            ? normalizedUpdate.notebookId
            : (existingContext.notebookId ?? null)
          const targetFolderId = hasFolderUpdate
            ? normalizedUpdate.folderId
            : targetNotebookId === null
              ? null
              : targetNotebookId !== (existingContext.notebookId ?? null)
                ? null
                : (existingContext.folderId ?? null)

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
            : normalizeNoteBody(existingContext.body)
          const effectiveExplicitLinks = hasLinksUpdate
            ? normalizeExplicitLinks(normalizedUpdate.links, id)
            : derivePreservedExplicitLinks(existingContext)

          const mergedLinks = mergeExplicitAndMarkdownLinks(
            effectiveExplicitLinks,
            effectiveBody,
            id,
          )

          const previousTargetIds = new Set(
            (existingContext.links || []).map((link) => link.targetId),
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

        const nextTitle = Object.hasOwn(normalizedUpdate, 'title')
          ? normalizedUpdate.title
          : existingContext.title
        const nextBody = hasBodyUpdate
          ? normalizedUpdate.body
          : normalizeNoteBody(existingContext.body)
        const nextTags = Object.hasOwn(normalizedUpdate, 'tags')
          ? normalizedUpdate.tags
          : existingContext.tags
        const existingReadiness = VALID_READINESS_SET.has(existingContext.readiness)
          ? existingContext.readiness
          : 'to_review'
        const existingNoteType = VALID_NOTE_TYPES_SET.has(existingContext.noteType)
          ? existingContext.noteType
          : 'standard'
        const nextReadiness = Object.hasOwn(normalizedUpdate, 'readiness')
          ? normalizedUpdate.readiness
          : existingReadiness
        const nextNoteType = Object.hasOwn(normalizedUpdate, 'noteType')
          ? normalizedUpdate.noteType
          : existingNoteType
        const nextNotebookId = Object.hasOwn(normalizedUpdate, 'notebookId')
          ? normalizedUpdate.notebookId
          : (existingContext.notebookId ?? null)
        const nextFolderId = Object.hasOwn(normalizedUpdate, 'folderId')
          ? normalizedUpdate.folderId
          : (existingContext.folderId ?? null)
        const nextLinks = Object.hasOwn(normalizedUpdate, 'links')
          ? normalizedUpdate.links
          : existingContext.links || []
        const nextExplicitLinks = Object.hasOwn(normalizedUpdate, 'explicitLinks')
          ? normalizedUpdate.explicitLinks
          : derivePreservedExplicitLinks(existingContext)

        const isNoOp =
          nextTitle === existingContext.title &&
          nextBody === normalizeNoteBody(existingContext.body) &&
          areStringArraysEqual(nextTags, existingContext.tags) &&
          nextReadiness === existingReadiness &&
          nextNoteType === existingNoteType &&
          nextNotebookId === (existingContext.notebookId ?? null) &&
          nextFolderId === (existingContext.folderId ?? null) &&
          areLinksEqual(nextLinks, existingContext.links) &&
          areLinksEqual(nextExplicitLinks, derivePreservedExplicitLinks(existingContext))

        if (isNoOp) {
          return normalizePersistedNote(existingContext)
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

        if (typeof fastify.recordDailyActivity === 'function') {
          await Promise.all([
            invalidateNoteCache(id, userId),
            fastify.recordDailyActivity(userId, { notesUpdated: 1 }, normalized.modifiedAt),
          ])
        } else {
          await invalidateNoteCache(id, userId)
        }

        if (fastify.eventBus) {
          const sanitizedEventDTO = {
            id: normalized.id,
            title: normalized.title,
            body: normalized.body,
            tags: normalized.tags,
            readiness: normalized.readiness,
            noteType: normalized.noteType,
            revision: normalized.revision,
            modifiedAt: normalized.modifiedAt,
          }
          const eventMessage = {
            type: 'NOTE_UPDATED',
            payload: sanitizedEventDTO,
          }
          fastify.eventBus.emit(`note_updated:${id}`, eventMessage, JSON.stringify(eventMessage))
        }

        return normalized
      },

      async deleteNote(id, userId, expectedRevision, request = null) {
        fastify.log.debug('Entering deleteNote method')
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
            fastify.log.debug(`Note not found for ID: ${id} and User ID: ${userId}`)
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

        const nowDeletedAt = instantToDate(nowInstant())

        const cascadeFlashcardsPromise = (async () => {
          const noteFlashcards = await flashcards
            .find({ userId, noteId: id }, { projection: { _id: 0, id: 1 } })
            .toArray()
          if (noteFlashcards.length > 0) {
            await Promise.all([
              flashcards.deleteMany({ userId, noteId: id }),
              syncTombstones.insertMany(
                noteFlashcards.map((fc) => ({
                  _id: randomUUIDv7(),
                  userId,
                  entityType: 'flashcard',
                  entityId: fc.id,
                  deletedAt: nowDeletedAt,
                })),
              ),
            ])
          }
        })()

        const cleanBacklinksPromise = (async () => {
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
        })()

        const deleteAttachmentsPromise =
          fastify.notesFileManager &&
          Array.isArray(deletedNote.attachments) &&
          deletedNote.attachments.length > 0
            ? fastify.notesFileManager.deleteNoteAttachments(deletedNote.attachments)
            : null

        await Promise.all([
          invalidateNoteCache(id, userId),
          cascadeFlashcardsPromise,
          syncTombstones.insertOne({
            _id: randomUUIDv7(),
            userId,
            entityType: 'note',
            entityId: id,
            deletedAt: nowDeletedAt,
          }),
          cleanBacklinksPromise,
          deleteAttachmentsPromise,
        ])

        if (fastify.auditLog) {
          fastify.auditLog({
            request,
            action: 'note_deleted',
            userId,
            resourceType: 'note',
            resourceId: id,
          })
        }

        if (fastify.eventBus) {
          fastify.eventBus.emit(`note_deleted:${id}`, { id })
        }

        fastify.log.debug('Exiting deleteNote method')
      },

      async addAttachments(id, attachments, userId) {
        const result = await notes.findOneAndUpdate(
          { id, userId },
          {
            $push: { attachments: { $each: attachments } },
            $set: { modifiedAt: instantToDate(nowInstant()) },
            $inc: { revision: 1 },
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

      async removeAttachment(id, fileId, userId) {
        const existingNote = await notes.findOne(
          { id, userId },
          { projection: { _id: 0, id: 1, attachments: 1 } },
        )
        if (!existingNote) {
          throw fastify.httpErrors.notFound('Note not found')
        }

        const targetAttachment = (existingNote.attachments || []).find(
          (att) => att.fileId === fileId,
        )
        if (!targetAttachment) {
          throw fastify.httpErrors.notFound('Attachment not found on this note')
        }

        const result = await notes.findOneAndUpdate(
          { id, userId },
          {
            $pull: { attachments: { fileId } },
            $set: { modifiedAt: instantToDate(nowInstant()) },
            $inc: { revision: 1 },
          },
          { returnDocument: 'after' },
        )

        const updatedNote = result?.value ?? result

        await invalidateNoteCache(id, userId)

        if (fastify.notesFileManager) {
          await fastify.notesFileManager.deleteNoteAttachments([targetAttachment])
        }

        return normalizePersistedNote(updatedNote)
      },

      async getUserStorageUsageBytes(userId) {
        const agg = await notes
          .aggregate([
            { $match: { userId, 'attachments.0': { $exists: true } } },
            { $unwind: '$attachments' },
            { $group: { _id: null, totalBytes: { $sum: '$attachments.size' } } },
          ])
          .toArray()

        return agg.length > 0 ? Number(agg[0].totalBytes || 0) : 0
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

      async getMindMapGraph(
        { rootNoteId, notebookId, folderId, maxDepth = 3, includeExternal = true } = {},
        userId,
      ) {
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
        const internalNodeIds = new Set()

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
                      readiness: '$readiness',
                      noteType: '$noteType',
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
                          readiness: '$$d.readiness',
                          noteType: '$$d.noteType',
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
          for (let i = 0; i < rawNodes.length; i += 1) {
            const n = rawNodes[i]
            if (n?.id) internalNodeIds.add(n.id)
          }
        } else {
          let effectiveContainerFilter = { ...containerFilter }
          if (folderId !== undefined) {
            const folderDoc = await folders.findOne(
              { id: folderId, userId },
              { projection: { _id: 0, id: 1, notebookId: 1 } },
            )
            if (folderDoc) {
              const allNbFolders = await folders
                .find(
                  { userId, notebookId: folderDoc.notebookId },
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
              effectiveContainerFilter = {
                ...containerFilter,
                folderId: { $in: subtreeFolderIds },
              }
            }
          }

          const directContainerNodes = await notes
            .find(effectiveContainerFilter, { projection: NOTE_GRAPH_NODE_PROJECTION })
            .sort({ modifiedAt: -1 })
            .toArray()

          for (const n of directContainerNodes) {
            if (n?.id) internalNodeIds.add(n.id)
          }

          let externalNodes = []
          const shouldExpandExternal =
            includeExternal !== false && (notebookId !== undefined || folderId !== undefined)

          if (shouldExpandExternal && directContainerNodes.length > 0) {
            const externalTargetIds = new Set()
            for (const n of directContainerNodes) {
              if (Array.isArray(n.links)) {
                for (const link of n.links) {
                  if (link?.targetId && !internalNodeIds.has(link.targetId)) {
                    externalTargetIds.add(link.targetId)
                  }
                }
              }
            }

            if (externalTargetIds.size > 0) {
              externalNodes = await notes
                .find(
                  { userId, id: { $in: Array.from(externalTargetIds) } },
                  { projection: NOTE_GRAPH_NODE_PROJECTION },
                )
                .toArray()
            }
          }

          rawNodes = [...directContainerNodes, ...externalNodes]
        }

        const nodeMap = new Map()
        for (const n of rawNodes) {
          if (!n || !n.id || nodeMap.has(n.id)) continue
          const isExternal = !internalNodeIds.has(n.id)
          nodeMap.set(n.id, {
            id: n.id,
            title: n.title,
            tags: Array.isArray(n.tags) ? n.tags : [],
            readiness: VALID_READINESS_SET.has(n.readiness) ? n.readiness : 'to_review',
            noteType: VALID_NOTE_TYPES_SET.has(n.noteType) ? n.noteType : 'standard',
            notebookId: n.notebookId ?? null,
            folderId: n.folderId ?? null,
            homeNotebookId: n.notebookId ?? null,
            isExternal,
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
          readiness: node.readiness,
          noteType: node.noteType,
          notebookId: node.notebookId,
          folderId: node.folderId,
          homeNotebookId: node.homeNotebookId,
          isExternal: node.isExternal,
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

      async getWorkspaceSyncDelta(since, userId, options = {}) {
        const sinceMs = Date.parse(since)
        if (Number.isNaN(sinceMs)) {
          throw fastify.httpErrors.badRequest('Invalid since timestamp')
        }

        const nowMs = Date.now()
        if (nowMs - sinceMs > SYNC_TOMBSTONE_TTL_MS || sinceMs > nowMs + 60_000) {
          const goneErr = fastify.httpErrors.gone('Sync cursor expired; perform a full sync')
          goneErr.syncCode = 'SYNC_CURSOR_EXPIRED'
          throw goneErr
        }

        const rawLimit = Number(options.limit ?? SYNC_DEFAULT_BATCH_LIMIT)
        const effectiveLimit = Number.isFinite(rawLimit)
          ? Math.min(Math.max(Math.trunc(rawLimit), 1), SYNC_MAX_BATCH_LIMIT)
          : SYNC_DEFAULT_BATCH_LIMIT
        const fetchLimit = effectiveLimit + 1

        const decodedCursor = decodeSyncCursor(options.cursor, sinceMs, nowMs, fastify)

        const syncStartMs = decodedCursor ? decodedCursor.t0 : Date.parse(nowIsoInstantString())
        const cursorStates = decodedCursor ? decodedCursor.s : null
        const sinceDate = new Date(sinceMs)

        const notesQuery = buildSyncCollectionQuery(
          userId,
          sinceDate,
          cursorStates?.notes,
          'modifiedAt',
          'id',
        )
        const notebooksQuery = buildSyncCollectionQuery(
          userId,
          sinceDate,
          cursorStates?.notebooks,
          'modifiedAt',
          'id',
        )
        const foldersQuery = buildSyncCollectionQuery(
          userId,
          sinceDate,
          cursorStates?.folders,
          'modifiedAt',
          'id',
        )
        const flashcardsQuery = buildSyncCollectionQuery(
          userId,
          sinceDate,
          cursorStates?.flashcards,
          'modifiedAt',
          'id',
        )
        const tombstonesQuery = buildSyncCollectionQuery(
          userId,
          sinceDate,
          cursorStates?.tombstones,
          'deletedAt',
          '_id',
        )

        const [rawNotes, rawNotebooks, rawFolders, rawFlashcards, rawTombstones] =
          await Promise.all([
            notesQuery
              ? notes
                  .find(notesQuery, { projection: NOTE_DETAIL_PROJECTION })
                  .sort({ modifiedAt: 1, id: 1 })
                  .limit(fetchLimit)
                  .toArray()
              : [],
            notebooksQuery
              ? notebooks
                  .find(notebooksQuery, { projection: { _id: 0, userId: 0 } })
                  .sort({ modifiedAt: 1, id: 1 })
                  .limit(fetchLimit)
                  .toArray()
              : [],
            foldersQuery
              ? folders
                  .find(foldersQuery, { projection: { _id: 0, userId: 0 } })
                  .sort({ modifiedAt: 1, id: 1 })
                  .limit(fetchLimit)
                  .toArray()
              : [],
            flashcardsQuery
              ? flashcards
                  .find(flashcardsQuery, { projection: { _id: 0, userId: 0 } })
                  .sort({ modifiedAt: 1, id: 1 })
                  .limit(fetchLimit)
                  .toArray()
              : [],
            tombstonesQuery
              ? syncTombstones
                  .find(tombstonesQuery, {
                    projection: { _id: 1, entityType: 1, entityId: 1, deletedAt: 1 },
                  })
                  .sort({ deletedAt: 1, _id: 1 })
                  .limit(fetchLimit)
                  .toArray()
              : [],
          ])

        const notesPage = sliceSyncBatch(rawNotes, effectiveLimit, 'modifiedAt', 'id')
        const notebooksPage = sliceSyncBatch(rawNotebooks, effectiveLimit, 'modifiedAt', 'id')
        const foldersPage = sliceSyncBatch(rawFolders, effectiveLimit, 'modifiedAt', 'id')
        const flashcardsPage = sliceSyncBatch(rawFlashcards, effectiveLimit, 'modifiedAt', 'id')
        const tombstonesPage = sliceSyncBatch(rawTombstones, effectiveLimit, 'deletedAt', '_id')

        const hasMore =
          notesPage.overflow ||
          notebooksPage.overflow ||
          foldersPage.overflow ||
          flashcardsPage.overflow ||
          tombstonesPage.overflow

        let serverTime
        let nextCursor = null

        if (hasMore) {
          const watermarkMs = Math.min(
            notesPage.overflowTimestampMs,
            notebooksPage.overflowTimestampMs,
            foldersPage.overflowTimestampMs,
            flashcardsPage.overflowTimestampMs,
            tombstonesPage.overflowTimestampMs,
          )
          serverTime = new Date(watermarkMs).toISOString()
          nextCursor = encodeSyncCursor(syncStartMs, {
            notes: notesPage.nextState,
            notebooks: notebooksPage.nextState,
            folders: foldersPage.nextState,
            flashcards: flashcardsPage.nextState,
            tombstones: tombstonesPage.nextState,
          })
        } else {
          serverTime = new Date(syncStartMs).toISOString()
        }

        const deletedNotes = new Set()
        const deletedNotebooks = new Set()
        const deletedFolders = new Set()
        const deletedFlashcards = new Set()

        for (const t of tombstonesPage.sliced) {
          if (t.entityType === 'note') deletedNotes.add(t.entityId)
          else if (t.entityType === 'notebook') deletedNotebooks.add(t.entityId)
          else if (t.entityType === 'folder') deletedFolders.add(t.entityId)
          else if (t.entityType === 'flashcard') deletedFlashcards.add(t.entityId)
        }

        return {
          serverTime,
          hasMore,
          nextCursor,
          notes: {
            upserted: notesPage.sliced.map(normalizePersistedNote),
            deletedIds: Array.from(deletedNotes),
          },
          notebooks: {
            upserted: notebooksPage.sliced.map((nb) => ({
              id: nb.id,
              name: nb.name,
              description: nb.description ?? '',
              mode: nb.mode === 'campaign' ? 'campaign' : 'notebook',
              status: nb.status === 'archived' ? 'archived' : 'active',
              targetDate:
                nb.targetDate instanceof Date
                  ? nb.targetDate.toISOString()
                  : (nb.targetDate ?? null),
              createdAt: nb.createdAt,
              modifiedAt: nb.modifiedAt,
            })),
            deletedIds: Array.from(deletedNotebooks),
          },
          folders: {
            upserted: foldersPage.sliced,
            deletedIds: Array.from(deletedFolders),
          },
          flashcards: {
            upserted: flashcardsPage.sliced.map((fc) => ({
              id: fc.id,
              noteId: fc.noteId,
              front: fc.front,
              back: fc.back,
              box: Number(fc.box) || 1,
              nextReviewAt: fc.nextReviewAt,
              lastReviewedAt: fc.lastReviewedAt ?? null,
              reviewCount: Number(fc.reviewCount || 0),
              lapseCount: Number(fc.lapseCount || 0),
              lastRating: fc.lastRating ?? null,
              createdAt: fc.createdAt,
              modifiedAt: fc.modifiedAt,
            })),
            deletedIds: Array.from(deletedFlashcards),
          },
        }
      },
    }

    fastify.decorate('notesDataSource', notesDataSource)
    fastify.decorateRequest('notesDataSource', null)
    fastify.decorate('bindScopedDataSources', async function bindScopedDataSources(request) {
      const userId = request.user?._id || request.user?.id
      if (userId) {
        request.notesDataSource = fastify.notesDataSource.forUser(userId, request)
        request.notebooksDataSource = fastify.notebooksDataSource.forUser(userId, request)
        if (fastify.flashcardsDataSource) {
          request.flashcardsDataSource = fastify.flashcardsDataSource.forUser(userId, request)
        }
      }
    })
    fastify.log.info('Successfully registered notes-store plugin')
  },
  {
    dependencies: [
      'db-plugin',
      'notebooks-store',
      'notes-file-manager',
      'flashcards-store',
      'app-cache',
    ],
    name: 'notes-store',
    decorators: {
      fastify: ['mongo', 'notebooksDataSource', 'notesFileManager', 'flashcardsDataSource'],
    },
  },
)

Object.defineProperty(notesStorePlugin, 'extractMarkdownLinks', {
  value: extractMarkdownLinks,
  enumerable: false,
})

module.exports = notesStorePlugin
