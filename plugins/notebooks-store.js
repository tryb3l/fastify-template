'use strict'

const fp = require('fastify-plugin')
const { randomUUIDv7 } = require('node:crypto')
const { parseIsoInstant, instantToDate, nowInstant } = require('../utils/time')

const MAX_FOLDER_DEPTH = 5
const VALID_NOTEBOOK_MODES = new Set(['notebook', 'campaign'])
const VALID_NOTEBOOK_STATUSES = new Set(['active', 'archived'])
const STARTER_TEMPLATES = Object.freeze({
  interview: Object.freeze([
    '01 - Screening & Recruiter',
    '02 - Technical & Coding',
    '03 - System Design & Architecture',
    '04 - Post-Mortems & Debriefs',
  ]),
  exam: Object.freeze([
    '01 - Core Syllabus',
    '02 - Practice & Mock Problems',
    '03 - Post-Mortems & Weak Spots',
  ]),
})

function normalizeTargetDateInput(targetDate) {
  if (targetDate === null || targetDate === undefined) {
    return null
  }
  if (targetDate instanceof Date) {
    return targetDate
  }
  if (typeof targetDate === 'string' && targetDate.trim() !== '') {
    return instantToDate(parseIsoInstant(targetDate.trim()))
  }
  return null
}

function normalizeNotebookDoc(notebook) {
  const rawTargetDate = notebook.targetDate ?? null
  const serializedTargetDate =
    rawTargetDate instanceof Date ? rawTargetDate.toISOString() : rawTargetDate
  return {
    id: notebook.id,
    name: notebook.name,
    description: notebook.description ?? '',
    mode: VALID_NOTEBOOK_MODES.has(notebook.mode) ? notebook.mode : 'notebook',
    status: VALID_NOTEBOOK_STATUSES.has(notebook.status) ? notebook.status : 'active',
    targetDate: serializedTargetDate,
    createdAt: notebook.createdAt,
    modifiedAt: notebook.modifiedAt,
  }
}

function computeReadinessSummary(noteItems, extraNoteIterable = null) {
  let toReviewCount = 0
  let inProgressCount = 0
  let masteredCount = 0

  for (const note of noteItems) {
    if (!note || note.noteType === 'post_mortem') {
      continue
    }
    const readiness = note.readiness || 'to_review'
    if (readiness === 'mastered') {
      masteredCount += 1
    } else if (readiness === 'in_progress') {
      inProgressCount += 1
    } else {
      toReviewCount += 1
    }
  }

  if (extraNoteIterable) {
    for (const note of extraNoteIterable) {
      if (!note || note.noteType === 'post_mortem') {
        continue
      }
      const readiness = note.readiness || 'to_review'
      if (readiness === 'mastered') {
        masteredCount += 1
      } else if (readiness === 'in_progress') {
        inProgressCount += 1
      } else {
        toReviewCount += 1
      }
    }
  }

  const totalCount = toReviewCount + inProgressCount + masteredCount
  if (totalCount === 0) {
    return {
      toReviewCount: 0,
      inProgressCount: 0,
      masteredCount: 0,
      totalCount: 0,
      scorePercent: 0,
      blocks: 0,
    }
  }

  const weightedSum = masteredCount * 1.0 + inProgressCount * 0.5
  const scorePercent = Math.round((weightedSum / totalCount) * 100)
  const blocks = Math.round(scorePercent / 10)

  return {
    toReviewCount,
    inProgressCount,
    masteredCount,
    totalCount,
    scorePercent,
    blocks,
  }
}

function computeAncestorDepthAndCheckCycle(folderMap, targetParentId, movingFolderId = null) {
  let depth = 0
  let currentId = targetParentId
  const visited = new Set()

  while (currentId !== null && currentId !== undefined) {
    if (movingFolderId && currentId === movingFolderId) {
      return { cycleDetected: true, depth }
    }
    if (visited.has(currentId)) {
      return { cycleDetected: true, depth }
    }
    visited.add(currentId)

    const currentFolder = folderMap.get(currentId)
    if (!currentFolder) {
      return { missingAncestor: true, depth }
    }

    depth += 1
    currentId = currentFolder.parentId ?? null
  }

  return { cycleDetected: false, missingAncestor: false, depth }
}

function computeMaxSubtreeHeight(folderMap, rootFolderId) {
  const childrenByParent = new Map()
  for (const folder of folderMap.values()) {
    const parentKey = folder.parentId ?? null
    if (!childrenByParent.has(parentKey)) {
      childrenByParent.set(parentKey, [])
    }
    childrenByParent.get(parentKey).push(folder.id)
  }

  let maxOffset = 0
  const stack = [{ id: rootFolderId, offset: 0 }]
  const visited = new Set([rootFolderId])

  while (stack.length > 0) {
    const { id, offset } = stack.pop()
    if (offset > maxOffset) {
      maxOffset = offset
    }

    const children = childrenByParent.get(id) || []
    for (const childId of children) {
      if (!visited.has(childId)) {
        visited.add(childId)
        stack.push({ id: childId, offset: offset + 1 })
      }
    }
  }

  return maxOffset
}

function assembleFolderTree(flatFolders, noteCountByFolderId, readinessByFolderId = new Map()) {
  const nodeMap = new Map()
  const roots = []

  for (const folder of flatFolders) {
    nodeMap.set(folder.id, {
      id: folder.id,
      notebookId: folder.notebookId,
      parentId: folder.parentId ?? null,
      name: folder.name,
      createdAt: folder.createdAt,
      modifiedAt: folder.modifiedAt,
      noteCount: noteCountByFolderId.get(folder.id) || 0,
      readiness: readinessByFolderId.get(folder.id) || computeReadinessSummary([]),
      children: [],
    })
  }

  for (const node of nodeMap.values()) {
    if (node.parentId && nodeMap.has(node.parentId)) {
      nodeMap.get(node.parentId).children.push(node)
    } else {
      roots.push(node)
    }
  }

  return roots
}

function computeFolderRollupReadiness(flatFolders, notesByFolderId, externalNotesById) {
  const childrenByParent = new Map()
  for (const folder of flatFolders) {
    const parentKey = folder.parentId ?? null
    if (!childrenByParent.has(parentKey)) {
      childrenByParent.set(parentKey, [])
    }
    childrenByParent.get(parentKey).push(folder.id)
  }

  const readinessByFolderId = new Map()

  for (const folder of flatFolders) {
    const subtreeFolderIds = []
    const stack = [folder.id]
    const visited = new Set([folder.id])

    while (stack.length > 0) {
      const currId = stack.pop()
      subtreeFolderIds.push(currId)
      const childIds = childrenByParent.get(currId) || []
      for (const childId of childIds) {
        if (!visited.has(childId)) {
          visited.add(childId)
          stack.push(childId)
        }
      }
    }

    const deduplicatedNotes = new Map()
    for (const fId of subtreeFolderIds) {
      const fNotes = notesByFolderId.get(fId) || []
      for (const note of fNotes) {
        deduplicatedNotes.set(note.id, note)
        if (Array.isArray(note.links)) {
          for (const link of note.links) {
            if (link?.targetId && externalNotesById.has(link.targetId)) {
              deduplicatedNotes.set(link.targetId, externalNotesById.get(link.targetId))
            }
          }
        }
      }
    }

    readinessByFolderId.set(folder.id, computeReadinessSummary(deduplicatedNotes.values()))
  }

  return readinessByFolderId
}

class ScopedNotebooksDataSource {
  constructor(store, userId, request = null) {
    this.store = store
    this.userId = userId
    this.request = request
  }

  createNotebook(data) {
    return this.store.createNotebook(data, this.userId, this.request)
  }

  listNotebooks(filter = {}) {
    return this.store.listNotebooks(this.userId, filter)
  }

  readNotebook(id) {
    return this.store.readNotebook(id, this.userId)
  }

  updateNotebook(id, data) {
    return this.store.updateNotebook(id, data, this.userId, this.request)
  }

  deleteNotebook(id) {
    return this.store.deleteNotebook(id, this.userId, this.request)
  }

  createFolder(data) {
    return this.store.createFolder(data, this.userId, this.request)
  }

  listFolders(notebookId) {
    return this.store.listFolders(notebookId, this.userId)
  }

  readFolder(id) {
    return this.store.readFolder(id, this.userId)
  }

  updateFolder(id, data) {
    return this.store.updateFolder(id, data, this.userId, this.request)
  }

  deleteFolder(id) {
    return this.store.deleteFolder(id, this.userId, this.request)
  }

  getNotebookTree(notebookId) {
    return this.store.getNotebookTree(notebookId, this.userId)
  }

  getWorkspaceTree() {
    return this.store.getWorkspaceTree(this.userId)
  }

  verifyContainerPlacement(placement) {
    return this.store.verifyContainerPlacement(placement, this.userId)
  }

  verifyContainerFilter(filter) {
    return this.store.verifyContainerFilter(filter, this.userId)
  }
}

module.exports = fp(
  async function notebooksStorePlugin(fastify) {
    fastify.log.info('Starting registration of notebooks-store plugin')

    const notebooks = fastify.mongo.db.collection('notebooks')
    const folders = fastify.mongo.db.collection('folders')
    const notes = fastify.mongo.db.collection('notes')
    const syncTombstones = fastify.mongo.db.collection('syncTombstones')

    async function recordSyncTombstone(userId, entityType, entityId) {
      await syncTombstones.insertOne({
        _id: randomUUIDv7(),
        userId,
        entityType,
        entityId,
        deletedAt: instantToDate(nowInstant()),
      })
    }

    const notebooksDataSource = {
      MAX_FOLDER_DEPTH,

      async createNotebook(
        {
          name,
          description = '',
          mode = 'notebook',
          status = 'active',
          targetDate = null,
          starterTemplate = null,
          starterFolders = null,
        },
        userId,
        request = null,
      ) {
        const _id = randomUUIDv7()
        const now = instantToDate(nowInstant())
        const normalizedMode = VALID_NOTEBOOK_MODES.has(mode) ? mode : 'notebook'
        const normalizedStatus = VALID_NOTEBOOK_STATUSES.has(status) ? status : 'active'
        const normalizedTargetDate = normalizeTargetDateInput(targetDate)

        const notebook = {
          _id,
          id: _id,
          userId,
          name,
          description: typeof description === 'string' ? description : '',
          mode: normalizedMode,
          status: normalizedStatus,
          targetDate: normalizedTargetDate,
          createdAt: now,
          modifiedAt: now,
        }

        await notebooks.insertOne(notebook)

        let foldersToSeed = []
        if (Array.isArray(starterFolders) && starterFolders.length > 0) {
          foldersToSeed = starterFolders
            .filter((f) => typeof f === 'string' && f.trim() !== '')
            .map((f) => f.trim().slice(0, 100))
            .slice(0, 10)
        } else if (starterTemplate && Object.hasOwn(STARTER_TEMPLATES, starterTemplate)) {
          foldersToSeed = [...STARTER_TEMPLATES[starterTemplate]]
        }

        if (foldersToSeed.length > 0) {
          const folderDocs = foldersToSeed.map((folderName) => {
            const folderId = randomUUIDv7()
            return {
              _id: folderId,
              id: folderId,
              userId,
              notebookId: _id,
              parentId: null,
              name: folderName,
              createdAt: now,
              modifiedAt: now,
            }
          })
          await folders.insertMany(folderDocs)
        }

        if (fastify.auditLog) {
          fastify.auditLog({
            request,
            action: normalizedMode === 'campaign' ? 'campaign_created' : 'notebook_created',
            userId,
            resourceType: 'notebook',
            resourceId: _id,
            details: { mode: normalizedMode },
          })
        }

        return normalizeNotebookDoc(notebook)
      },

      async listNotebooks(userId, filter = {}) {
        const query = { userId }
        if (filter.mode && VALID_NOTEBOOK_MODES.has(filter.mode)) {
          query.mode = filter.mode === 'notebook' ? { $in: ['notebook', null] } : filter.mode
        }
        if (filter.status && VALID_NOTEBOOK_STATUSES.has(filter.status)) {
          query.status = filter.status === 'active' ? { $in: ['active', null] } : filter.status
        }
        const docs = await notebooks
          .find(query, { projection: { _id: 0, userId: 0 } })
          .sort({ modifiedAt: -1 })
          .toArray()
        return docs.map(normalizeNotebookDoc)
      },

      async readNotebook(id, userId) {
        const notebook = await notebooks.findOne(
          { id, userId },
          { projection: { _id: 0, userId: 0 } },
        )
        if (!notebook) {
          throw fastify.httpErrors.notFound('Notebook not found')
        }
        return normalizeNotebookDoc(notebook)
      },

      async updateNotebook(id, updateData, userId, request = null) {
        const updates = {
          modifiedAt: instantToDate(nowInstant()),
        }
        if (Object.hasOwn(updateData, 'name')) {
          updates.name = updateData.name
        }
        if (Object.hasOwn(updateData, 'description')) {
          updates.description =
            typeof updateData.description === 'string' ? updateData.description : ''
        }
        if (Object.hasOwn(updateData, 'mode') && VALID_NOTEBOOK_MODES.has(updateData.mode)) {
          updates.mode = updateData.mode
        }
        if (Object.hasOwn(updateData, 'status') && VALID_NOTEBOOK_STATUSES.has(updateData.status)) {
          updates.status = updateData.status
        }
        if (Object.hasOwn(updateData, 'targetDate')) {
          updates.targetDate = normalizeTargetDateInput(updateData.targetDate)
        }

        const result = await notebooks.findOneAndUpdate(
          { id, userId },
          { $set: updates },
          { returnDocument: 'after', projection: { _id: 0, userId: 0 } },
        )

        const updated = result?.value ?? result
        if (!updated) {
          throw fastify.httpErrors.notFound('Notebook not found')
        }

        if (fastify.auditLog) {
          fastify.auditLog({
            request,
            action: updates.status === 'archived' ? 'notebook_archived' : 'notebook_updated',
            userId,
            resourceType: 'notebook',
            resourceId: id,
          })
        }

        return normalizeNotebookDoc(updated)
      },

      async deleteNotebook(id, userId, request = null) {
        await this.readNotebook(id, userId)

        const [folderCount, noteCount] = await Promise.all([
          folders.countDocuments({ userId, notebookId: id }, { limit: 1 }),
          notes.countDocuments({ userId, notebookId: id }, { limit: 1 }),
        ])

        if (folderCount > 0 || noteCount > 0) {
          const conflictError = fastify.httpErrors.conflict(
            'Notebook is not empty. Remove or move its folders and notes before deleting.',
          )
          conflictError.conflictCode = 'NOTEBOOK_NOT_EMPTY'
          throw conflictError
        }

        await notebooks.deleteOne({ id, userId })
        await recordSyncTombstone(userId, 'notebook', id)

        if (fastify.auditLog) {
          fastify.auditLog({
            request,
            action: 'notebook_deleted',
            userId,
            resourceType: 'notebook',
            resourceId: id,
          })
        }
      },

      async createFolder({ notebookId, parentId = null, name }, userId, request = null) {
        await this.readNotebook(notebookId, userId)

        const normalizedParentId = parentId ?? null
        if (normalizedParentId !== null) {
          const existingFolders = await folders
            .find(
              { userId, notebookId },
              { projection: { _id: 0, id: 1, parentId: 1, notebookId: 1 } },
            )
            .toArray()
          const folderMap = new Map(existingFolders.map((f) => [f.id, f]))

          if (!folderMap.has(normalizedParentId)) {
            const crossNotebookFolder = await folders.findOne(
              { id: normalizedParentId, userId },
              { projection: { _id: 0, id: 1, notebookId: 1 } },
            )
            if (crossNotebookFolder) {
              throw fastify.httpErrors.badRequest('Parent folder belongs to a different notebook')
            }
            throw fastify.httpErrors.notFound('Parent folder not found')
          }

          const { depth } = computeAncestorDepthAndCheckCycle(folderMap, normalizedParentId)
          if (depth + 1 > MAX_FOLDER_DEPTH) {
            throw fastify.httpErrors.badRequest(
              `Folder nesting exceeds maximum depth of ${MAX_FOLDER_DEPTH}`,
            )
          }
        }

        const _id = randomUUIDv7()
        const now = instantToDate(nowInstant())
        const folder = {
          _id,
          id: _id,
          userId,
          notebookId,
          parentId: normalizedParentId,
          name,
          createdAt: now,
          modifiedAt: now,
        }

        await folders.insertOne(folder)

        if (fastify.auditLog) {
          fastify.auditLog({
            request,
            action: 'folder_created',
            userId,
            resourceType: 'folder',
            resourceId: _id,
            details: { notebookId, parentId: normalizedParentId },
          })
        }

        return {
          id: folder.id,
          notebookId: folder.notebookId,
          parentId: folder.parentId,
          name: folder.name,
          createdAt: folder.createdAt,
          modifiedAt: folder.modifiedAt,
        }
      },

      async listFolders(notebookId, userId) {
        await this.readNotebook(notebookId, userId)
        return await folders
          .find({ userId, notebookId }, { projection: { _id: 0, userId: 0 } })
          .sort({ name: 1 })
          .toArray()
      },

      async readFolder(id, userId) {
        const folder = await folders.findOne({ id, userId }, { projection: { _id: 0, userId: 0 } })
        if (!folder) {
          throw fastify.httpErrors.notFound('Folder not found')
        }
        return folder
      },

      async updateFolder(id, updateData, userId, request = null) {
        const existingFolder = await this.readFolder(id, userId)

        if (
          Object.hasOwn(updateData, 'notebookId') &&
          updateData.notebookId !== existingFolder.notebookId
        ) {
          throw fastify.httpErrors.badRequest('Folder cannot be moved across different notebooks')
        }

        const updates = {
          modifiedAt: instantToDate(nowInstant()),
        }

        if (Object.hasOwn(updateData, 'name')) {
          updates.name = updateData.name
        }

        if (Object.hasOwn(updateData, 'parentId')) {
          const nextParentId = updateData.parentId ?? null
          if (nextParentId === id) {
            throw fastify.httpErrors.badRequest('Folder cannot be its own parent')
          }

          const notebookFolders = await folders
            .find(
              { userId, notebookId: existingFolder.notebookId },
              { projection: { _id: 0, id: 1, parentId: 1, notebookId: 1 } },
            )
            .toArray()
          const folderMap = new Map(notebookFolders.map((f) => [f.id, f]))

          if (nextParentId !== null && !folderMap.has(nextParentId)) {
            const crossNotebookFolder = await folders.findOne(
              { id: nextParentId, userId },
              { projection: { _id: 0, id: 1, notebookId: 1 } },
            )
            if (crossNotebookFolder) {
              throw fastify.httpErrors.badRequest(
                'Folder cannot be moved across different notebooks',
              )
            }
            throw fastify.httpErrors.notFound('Parent folder not found')
          }

          const { cycleDetected, depth: parentDepth } = computeAncestorDepthAndCheckCycle(
            folderMap,
            nextParentId,
            id,
          )

          if (cycleDetected) {
            throw fastify.httpErrors.badRequest('Cannot move a folder into its own descendant')
          }

          const subtreeHeight = computeMaxSubtreeHeight(folderMap, id)
          if (parentDepth + 1 + subtreeHeight > MAX_FOLDER_DEPTH) {
            throw fastify.httpErrors.badRequest(
              `Folder nesting exceeds maximum depth of ${MAX_FOLDER_DEPTH}`,
            )
          }

          updates.parentId = nextParentId
        }

        const result = await folders.findOneAndUpdate(
          { id, userId },
          { $set: updates },
          { returnDocument: 'after', projection: { _id: 0, userId: 0 } },
        )

        const updatedFolder = result?.value ?? result
        if (fastify.auditLog && updatedFolder) {
          fastify.auditLog({
            request,
            action: 'folder_updated',
            userId,
            resourceType: 'folder',
            resourceId: id,
          })
        }

        return updatedFolder
      },

      async deleteFolder(id, userId, request = null) {
        await this.readFolder(id, userId)

        const [childFolderCount, noteCount] = await Promise.all([
          folders.countDocuments({ userId, parentId: id }, { limit: 1 }),
          notes.countDocuments({ userId, folderId: id }, { limit: 1 }),
        ])

        if (childFolderCount > 0 || noteCount > 0) {
          const conflictError = fastify.httpErrors.conflict(
            'Folder is not empty. Remove or move its subfolders and notes before deleting.',
          )
          conflictError.conflictCode = 'FOLDER_NOT_EMPTY'
          throw conflictError
        }

        await folders.deleteOne({ id, userId })
        await recordSyncTombstone(userId, 'folder', id)

        if (fastify.auditLog) {
          fastify.auditLog({
            request,
            action: 'folder_deleted',
            userId,
            resourceType: 'folder',
            resourceId: id,
          })
        }
      },

      async getNotebookTree(notebookId, userId) {
        const notebook = await this.readNotebook(notebookId, userId)

        const [notebookFolders, notebookNotes] = await Promise.all([
          folders
            .find({ userId, notebookId }, { projection: { _id: 0, userId: 0 } })
            .sort({ name: 1 })
            .toArray(),
          notes
            .find(
              { userId, notebookId },
              {
                projection: {
                  _id: 0,
                  id: 1,
                  notebookId: 1,
                  folderId: 1,
                  readiness: 1,
                  noteType: 1,
                  links: 1,
                },
              },
            )
            .toArray(),
        ])

        const directNoteIds = new Set()
        for (let i = 0; i < notebookNotes.length; i += 1) {
          directNoteIds.add(notebookNotes[i].id)
        }
        const externalTargetIds = new Set()
        for (let i = 0; i < notebookNotes.length; i += 1) {
          const note = notebookNotes[i]
          if (Array.isArray(note.links)) {
            for (let j = 0; j < note.links.length; j += 1) {
              const targetId = note.links[j]?.targetId
              if (targetId && !directNoteIds.has(targetId)) {
                externalTargetIds.add(targetId)
              }
            }
          }
        }

        let externalNotes = []
        if (externalTargetIds.size > 0) {
          externalNotes = await notes
            .find(
              { userId, id: { $in: Array.from(externalTargetIds) } },
              {
                projection: {
                  _id: 0,
                  id: 1,
                  notebookId: 1,
                  folderId: 1,
                  readiness: 1,
                  noteType: 1,
                },
              },
            )
            .toArray()
        }
        const externalNotesById = new Map()
        for (let i = 0; i < externalNotes.length; i += 1) {
          const ext = externalNotes[i]
          externalNotesById.set(ext.id, ext)
        }

        const noteCountByFolderId = new Map()
        const notesByFolderId = new Map()
        let rootNoteCount = 0
        const totalNoteCount = notebookNotes.length

        for (const note of notebookNotes) {
          const fldId = note.folderId ?? null
          if (fldId === null) {
            rootNoteCount += 1
          } else {
            noteCountByFolderId.set(fldId, (noteCountByFolderId.get(fldId) || 0) + 1)
            if (!notesByFolderId.has(fldId)) {
              notesByFolderId.set(fldId, [])
            }
            notesByFolderId.get(fldId).push(note)
          }
        }

        const readinessByFolderId = computeFolderRollupReadiness(
          notebookFolders,
          notesByFolderId,
          externalNotesById,
        )

        return {
          id: notebook.id,
          name: notebook.name,
          description: notebook.description,
          mode: notebook.mode,
          status: notebook.status,
          targetDate: notebook.targetDate,
          createdAt: notebook.createdAt,
          modifiedAt: notebook.modifiedAt,
          rootNoteCount,
          totalNoteCount,
          readiness: computeReadinessSummary(notebookNotes, externalNotes),
          folders: assembleFolderTree(notebookFolders, noteCountByFolderId, readinessByFolderId),
        }
      },

      async getWorkspaceTree(userId) {
        const [userNotebooks, userFolders, allUserNotes] = await Promise.all([
          notebooks
            .find({ userId }, { projection: { _id: 0, userId: 0 } })
            .sort({ modifiedAt: -1 })
            .toArray(),
          folders
            .find({ userId }, { projection: { _id: 0, userId: 0 } })
            .sort({ name: 1 })
            .toArray(),
          notes
            .find(
              { userId },
              {
                projection: {
                  _id: 0,
                  id: 1,
                  notebookId: 1,
                  folderId: 1,
                  readiness: 1,
                  noteType: 1,
                  links: 1,
                },
              },
            )
            .toArray(),
        ])

        const allNotesById = new Map()
        for (let i = 0; i < allUserNotes.length; i += 1) {
          const n = allUserNotes[i]
          allNotesById.set(n.id, n)
        }
        let inboxNoteCount = 0
        const rootCountByNotebook = new Map()
        const totalCountByNotebook = new Map()
        const noteCountByFolderId = new Map()
        const notesByNotebook = new Map()
        const notesByFolderId = new Map()

        for (const note of allUserNotes) {
          const nbId = note.notebookId ?? null
          const fldId = note.folderId ?? null

          if (nbId === null) {
            inboxNoteCount += 1
            continue
          }

          if (!notesByNotebook.has(nbId)) {
            notesByNotebook.set(nbId, [])
          }
          notesByNotebook.get(nbId).push(note)

          totalCountByNotebook.set(nbId, (totalCountByNotebook.get(nbId) || 0) + 1)
          if (fldId === null) {
            rootCountByNotebook.set(nbId, (rootCountByNotebook.get(nbId) || 0) + 1)
          } else {
            noteCountByFolderId.set(fldId, (noteCountByFolderId.get(fldId) || 0) + 1)
            if (!notesByFolderId.has(fldId)) {
              notesByFolderId.set(fldId, [])
            }
            notesByFolderId.get(fldId).push(note)
          }
        }

        const foldersByNotebook = new Map()
        for (const folder of userFolders) {
          if (!foldersByNotebook.has(folder.notebookId)) {
            foldersByNotebook.set(folder.notebookId, [])
          }
          foldersByNotebook.get(folder.notebookId).push(folder)
        }

        const notebookTrees = userNotebooks.map((rawNb) => {
          const nb = normalizeNotebookDoc(rawNb)
          const nbFolders = foldersByNotebook.get(nb.id) || []
          const nbDirectNotes = notesByNotebook.get(nb.id) || []
          const directIds = new Set()
          for (let i = 0; i < nbDirectNotes.length; i += 1) {
            directIds.add(nbDirectNotes[i].id)
          }

          const externalNotesById = new Map()
          for (let i = 0; i < nbDirectNotes.length; i += 1) {
            const note = nbDirectNotes[i]
            if (Array.isArray(note.links)) {
              for (let j = 0; j < note.links.length; j += 1) {
                const targetId = note.links[j]?.targetId
                if (targetId && !directIds.has(targetId) && allNotesById.has(targetId)) {
                  externalNotesById.set(targetId, allNotesById.get(targetId))
                }
              }
            }
          }

          const readinessByFolderId = computeFolderRollupReadiness(
            nbFolders,
            notesByFolderId,
            externalNotesById,
          )

          return {
            id: nb.id,
            name: nb.name,
            description: nb.description,
            mode: nb.mode,
            status: nb.status,
            targetDate: nb.targetDate,
            createdAt: nb.createdAt,
            modifiedAt: nb.modifiedAt,
            rootNoteCount: rootCountByNotebook.get(nb.id) || 0,
            totalNoteCount: totalCountByNotebook.get(nb.id) || 0,
            readiness: computeReadinessSummary(nbDirectNotes, externalNotesById.values()),
            folders: assembleFolderTree(nbFolders, noteCountByFolderId, readinessByFolderId),
          }
        })

        return {
          inboxNoteCount,
          notebooks: notebookTrees,
        }
      },

      async verifyContainerPlacement({ notebookId, folderId }, userId) {
        const normalizedNotebookId = notebookId ?? null
        const normalizedFolderId = folderId ?? null

        if (normalizedNotebookId === null && normalizedFolderId !== null) {
          throw fastify.httpErrors.badRequest('Folder requires an owning notebookId')
        }

        if (normalizedNotebookId !== null) {
          await this.readNotebook(normalizedNotebookId, userId)
        }

        if (normalizedFolderId !== null) {
          const folder = await this.readFolder(normalizedFolderId, userId)
          if (folder.notebookId !== normalizedNotebookId) {
            throw fastify.httpErrors.badRequest('Folder does not belong to the specified notebook')
          }
        }

        return {
          notebookId: normalizedNotebookId,
          folderId: normalizedFolderId,
        }
      },

      async verifyContainerFilter({ notebookId, folderId } = {}, userId) {
        if (
          (notebookId === undefined || notebookId === null) &&
          (folderId === undefined || folderId === null)
        ) {
          return
        }

        if (notebookId && folderId) {
          await this.verifyContainerPlacement({ notebookId, folderId }, userId)
        } else if (notebookId) {
          await this.readNotebook(notebookId, userId)
        } else if (folderId) {
          await this.readFolder(folderId, userId)
        }
      },

      forUser(userId, request = null) {
        return new ScopedNotebooksDataSource(this, userId, request)
      },
    }

    fastify.decorate('notebooksDataSource', notebooksDataSource)
    fastify.decorateRequest('notebooksDataSource', null)

    fastify.log.info('Successfully registered notebooks-store plugin')
  },
  {
    dependencies: ['db-plugin'],
    name: 'notebooks-store',
    decorators: {
      fastify: ['mongo'],
    },
  },
)
