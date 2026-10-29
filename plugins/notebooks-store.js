'use strict'

const fp = require('fastify-plugin')
const { randomUUIDv7 } = require('node:crypto')
const { instantToDate, nowInstant } = require('../utils/time')

const MAX_FOLDER_DEPTH = 5

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

function assembleFolderTree(flatFolders, noteCountByFolderId) {
  const nodeMap = new Map()
  const roots = []

  for (const folder of flatFolders) {
    nodeMap.set(folder.id, {
      ...folder,
      noteCount: noteCountByFolderId.get(folder.id) || 0,
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

class ScopedNotebooksDataSource {
  constructor(store, userId, request = null) {
    this.store = store
    this.userId = userId
    this.request = request
  }

  createNotebook(data) {
    return this.store.createNotebook(data, this.userId, this.request)
  }

  listNotebooks() {
    return this.store.listNotebooks(this.userId)
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

    const notebooksDataSource = {
      MAX_FOLDER_DEPTH,

      async createNotebook({ name, description = '' }, userId, request = null) {
        const _id = randomUUIDv7()
        const now = instantToDate(nowInstant())
        const notebook = {
          _id,
          id: _id,
          userId,
          name,
          description: typeof description === 'string' ? description : '',
          createdAt: now,
          modifiedAt: now,
        }

        await notebooks.insertOne(notebook)

        if (fastify.auditLog) {
          fastify.auditLog({
            request,
            action: 'notebook_created',
            userId,
            resourceType: 'notebook',
            resourceId: _id,
          })
        }

        return {
          id: notebook.id,
          name: notebook.name,
          description: notebook.description,
          createdAt: notebook.createdAt,
          modifiedAt: notebook.modifiedAt,
        }
      },

      async listNotebooks(userId) {
        return await notebooks
          .find({ userId }, { projection: { _id: 0, userId: 0 } })
          .sort({ modifiedAt: -1 })
          .toArray()
      },

      async readNotebook(id, userId) {
        const notebook = await notebooks.findOne(
          { id, userId },
          { projection: { _id: 0, userId: 0 } },
        )
        if (!notebook) {
          throw fastify.httpErrors.notFound('Notebook not found')
        }
        return notebook
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
            action: 'notebook_updated',
            userId,
            resourceType: 'notebook',
            resourceId: id,
          })
        }

        return updated
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

        const [notebookFolders, groupedNoteCounts] = await Promise.all([
          folders
            .find({ userId, notebookId }, { projection: { _id: 0, userId: 0 } })
            .sort({ name: 1 })
            .toArray(),
          notes
            .aggregate([
              { $match: { userId, notebookId } },
              { $group: { _id: '$folderId', count: { $sum: 1 } } },
            ])
            .toArray(),
        ])

        const noteCountByFolderId = new Map()
        let rootNoteCount = 0
        let totalNoteCount = 0

        for (const group of groupedNoteCounts) {
          totalNoteCount += group.count
          if (group._id === null || group._id === undefined) {
            rootNoteCount += group.count
          } else {
            noteCountByFolderId.set(group._id, group.count)
          }
        }

        return {
          ...notebook,
          rootNoteCount,
          totalNoteCount,
          folders: assembleFolderTree(notebookFolders, noteCountByFolderId),
        }
      },

      async getWorkspaceTree(userId) {
        const [userNotebooks, userFolders, groupedNoteCounts] = await Promise.all([
          notebooks
            .find({ userId }, { projection: { _id: 0, userId: 0 } })
            .sort({ modifiedAt: -1 })
            .toArray(),
          folders
            .find({ userId }, { projection: { _id: 0, userId: 0 } })
            .sort({ name: 1 })
            .toArray(),
          notes
            .aggregate([
              { $match: { userId } },
              {
                $group: {
                  _id: { notebookId: '$notebookId', folderId: '$folderId' },
                  count: { $sum: 1 },
                },
              },
            ])
            .toArray(),
        ])

        let inboxNoteCount = 0
        const rootCountByNotebook = new Map()
        const totalCountByNotebook = new Map()
        const noteCountByFolderId = new Map()

        for (const group of groupedNoteCounts) {
          const nbId = group._id?.notebookId ?? null
          const fldId = group._id?.folderId ?? null

          if (nbId === null) {
            inboxNoteCount += group.count
            continue
          }

          totalCountByNotebook.set(nbId, (totalCountByNotebook.get(nbId) || 0) + group.count)
          if (fldId === null) {
            rootCountByNotebook.set(nbId, (rootCountByNotebook.get(nbId) || 0) + group.count)
          } else {
            noteCountByFolderId.set(fldId, group.count)
          }
        }

        const foldersByNotebook = new Map()
        for (const folder of userFolders) {
          if (!foldersByNotebook.has(folder.notebookId)) {
            foldersByNotebook.set(folder.notebookId, [])
          }
          foldersByNotebook.get(folder.notebookId).push(folder)
        }

        const notebookTrees = userNotebooks.map((nb) => ({
          ...nb,
          rootNoteCount: rootCountByNotebook.get(nb.id) || 0,
          totalNoteCount: totalCountByNotebook.get(nb.id) || 0,
          folders: assembleFolderTree(foldersByNotebook.get(nb.id) || [], noteCountByFolderId),
        }))

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
