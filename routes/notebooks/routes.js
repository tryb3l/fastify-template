'use strict'

const notebookSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'description', 'createdAt', 'modifiedAt'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string', minLength: 1, maxLength: 100 },
    description: { type: 'string', maxLength: 500 },
    createdAt: { type: 'string', format: 'date-time' },
    modifiedAt: { type: 'string', format: 'date-time' },
  },
}

const folderSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'notebookId', 'parentId', 'name', 'createdAt', 'modifiedAt'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    notebookId: { type: 'string', format: 'uuid' },
    parentId: { type: ['string', 'null'], format: 'uuid' },
    name: { type: 'string', minLength: 1, maxLength: 100 },
    createdAt: { type: 'string', format: 'date-time' },
    modifiedAt: { type: 'string', format: 'date-time' },
  },
}

function buildFolderTreeNodeSchema(remainingDepth = 5) {
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'notebookId',
      'parentId',
      'name',
      'createdAt',
      'modifiedAt',
      'noteCount',
      'children',
    ],
    properties: {
      ...folderSchema.properties,
      noteCount: { type: 'integer', minimum: 0 },
      children: {
        type: 'array',
        items:
          remainingDepth > 1 ? buildFolderTreeNodeSchema(remainingDepth - 1) : { type: 'object' },
      },
    },
  }
}

const folderTreeNodeSchema = buildFolderTreeNodeSchema(5)

const notebookTreeSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'name',
    'description',
    'createdAt',
    'modifiedAt',
    'rootNoteCount',
    'totalNoteCount',
    'folders',
  ],
  properties: {
    ...notebookSchema.properties,
    rootNoteCount: { type: 'integer', minimum: 0 },
    totalNoteCount: { type: 'integer', minimum: 0 },
    folders: {
      type: 'array',
      items: folderTreeNodeSchema,
    },
  },
}

const workspaceTreeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['inboxNoteCount', 'notebooks'],
  properties: {
    inboxNoteCount: { type: 'integer', minimum: 0 },
    notebooks: {
      type: 'array',
      items: notebookTreeSchema,
    },
  },
}

module.exports = async function notebookRoutes(fastify, opts) {
  const nodeEnv =
    opts?.configData?.NODE_ENV ||
    fastify.config?.NODE_ENV ||
    fastify.secrets?.NODE_ENV ||
    process.env.NODE_ENV
  const notebooksRateLimit = {
    max: nodeEnv === 'test' ? 15 : 60,
    timeWindow: '1 minute',
  }

  fastify.route({
    method: 'GET',
    url: '/',
    config: { rateLimit: notebooksRateLimit },
    schema: {
      tags: ['notebooks'],
      summary: 'List all notebooks for the current user',
      response: {
        200: {
          type: 'object',
          additionalProperties: false,
          required: ['data'],
          properties: {
            data: { type: 'array', items: notebookSchema },
          },
        },
      },
    },
    handler: async function listNotebooksHandler(request) {
      const notebooks = await request.notebooksDataSource.listNotebooks()
      return { data: notebooks }
    },
  })

  fastify.route({
    method: 'GET',
    url: '/tree',
    config: { rateLimit: notebooksRateLimit },
    schema: {
      tags: ['notebooks'],
      summary:
        'Get complete workspace tree (Inbox count, Notebooks, nested Folders, and note counts)',
      response: {
        200: {
          type: 'object',
          additionalProperties: false,
          required: ['data'],
          properties: { data: workspaceTreeSchema },
        },
      },
    },
    handler: async function getWorkspaceTreeHandler(request) {
      const tree = await request.notebooksDataSource.getWorkspaceTree()
      return { data: tree }
    },
  })

  fastify.route({
    method: 'POST',
    url: '/',
    config: { rateLimit: notebooksRateLimit },
    schema: {
      tags: ['notebooks'],
      summary: 'Create a top-level notebook',
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          description: { type: 'string', maxLength: 500 },
        },
      },
      response: {
        201: {
          type: 'object',
          additionalProperties: false,
          required: ['data'],
          properties: { data: notebookSchema },
        },
      },
    },
    handler: async function createNotebookHandler(request, reply) {
      const notebook = await request.notebooksDataSource.createNotebook(request.body)
      reply.code(201)
      return { data: notebook }
    },
  })

  fastify.route({
    method: 'GET',
    url: '/:id',
    config: { rateLimit: notebooksRateLimit },
    schema: {
      tags: ['notebooks'],
      summary: 'Read a notebook by id',
      params: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      response: {
        200: {
          type: 'object',
          additionalProperties: false,
          required: ['data'],
          properties: { data: notebookSchema },
        },
      },
    },
    handler: async function readNotebookHandler(request) {
      const notebook = await request.notebooksDataSource.readNotebook(request.params.id)
      return { data: notebook }
    },
  })

  fastify.route({
    method: 'GET',
    url: '/:id/tree',
    config: { rateLimit: notebooksRateLimit },
    schema: {
      tags: ['notebooks'],
      summary: 'Get nested folder tree and note counts for a notebook',
      params: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      response: {
        200: {
          type: 'object',
          additionalProperties: false,
          required: ['data'],
          properties: { data: notebookTreeSchema },
        },
      },
    },
    handler: async function getNotebookTreeHandler(request) {
      const tree = await request.notebooksDataSource.getNotebookTree(request.params.id)
      return { data: tree }
    },
  })

  fastify.route({
    method: 'PUT',
    url: '/:id',
    config: { rateLimit: notebooksRateLimit },
    schema: {
      tags: ['notebooks'],
      summary: 'Update a notebook by id',
      params: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      body: {
        type: 'object',
        additionalProperties: false,
        minProperties: 1,
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          description: { type: 'string', maxLength: 500 },
        },
      },
      response: {
        200: {
          type: 'object',
          additionalProperties: false,
          required: ['data'],
          properties: { data: notebookSchema },
        },
      },
    },
    handler: async function updateNotebookHandler(request) {
      const updated = await request.notebooksDataSource.updateNotebook(
        request.params.id,
        request.body,
      )
      return { data: updated }
    },
  })

  fastify.route({
    method: 'DELETE',
    url: '/:id',
    config: { rateLimit: notebooksRateLimit },
    schema: {
      tags: ['notebooks'],
      summary: 'Delete an empty notebook by id',
      params: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      response: {
        204: { type: 'null' },
        409: {
          type: 'object',
          additionalProperties: false,
          required: ['message', 'code'],
          properties: {
            message: { type: 'string' },
            code: { type: 'string' },
          },
        },
      },
    },
    handler: async function deleteNotebookHandler(request, reply) {
      await request.notebooksDataSource.deleteNotebook(request.params.id)
      reply.code(204).send()
    },
  })

  fastify.route({
    method: 'GET',
    url: '/:id/folders',
    config: { rateLimit: notebooksRateLimit },
    schema: {
      tags: ['notebooks'],
      summary: 'List folders inside a notebook',
      params: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      response: {
        200: {
          type: 'object',
          additionalProperties: false,
          required: ['data'],
          properties: {
            data: { type: 'array', items: folderSchema },
          },
        },
      },
    },
    handler: async function listFoldersHandler(request) {
      const folders = await request.notebooksDataSource.listFolders(request.params.id)
      return { data: folders }
    },
  })

  fastify.route({
    method: 'POST',
    url: '/:id/folders',
    config: { rateLimit: notebooksRateLimit },
    schema: {
      tags: ['notebooks'],
      summary: 'Create a folder inside a notebook (nested up to depth 5)',
      params: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          parentId: { type: ['string', 'null'], format: 'uuid' },
        },
      },
      response: {
        201: {
          type: 'object',
          additionalProperties: false,
          required: ['data'],
          properties: { data: folderSchema },
        },
      },
    },
    handler: async function createFolderHandler(request, reply) {
      const folder = await request.notebooksDataSource.createFolder({
        notebookId: request.params.id,
        name: request.body.name,
        parentId: request.body.parentId ?? null,
      })
      reply.code(201)
      return { data: folder }
    },
  })

  fastify.route({
    method: 'GET',
    url: '/folders/:folderId',
    config: { rateLimit: notebooksRateLimit },
    schema: {
      tags: ['notebooks'],
      summary: 'Read a folder by id',
      params: {
        type: 'object',
        additionalProperties: false,
        required: ['folderId'],
        properties: { folderId: { type: 'string', format: 'uuid' } },
      },
      response: {
        200: {
          type: 'object',
          additionalProperties: false,
          required: ['data'],
          properties: { data: folderSchema },
        },
      },
    },
    handler: async function readFolderHandler(request) {
      const folder = await request.notebooksDataSource.readFolder(request.params.folderId)
      return { data: folder }
    },
  })

  fastify.route({
    method: 'PUT',
    url: '/folders/:folderId',
    config: { rateLimit: notebooksRateLimit },
    schema: {
      tags: ['notebooks'],
      summary: 'Rename or reparent a folder within its owning notebook',
      params: {
        type: 'object',
        additionalProperties: false,
        required: ['folderId'],
        properties: { folderId: { type: 'string', format: 'uuid' } },
      },
      body: {
        type: 'object',
        additionalProperties: false,
        minProperties: 1,
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          parentId: { type: ['string', 'null'], format: 'uuid' },
          notebookId: { type: 'string', format: 'uuid' },
        },
      },
      response: {
        200: {
          type: 'object',
          additionalProperties: false,
          required: ['data'],
          properties: { data: folderSchema },
        },
      },
    },
    handler: async function updateFolderHandler(request) {
      const folder = await request.notebooksDataSource.updateFolder(
        request.params.folderId,
        request.body,
      )
      return { data: folder }
    },
  })

  fastify.route({
    method: 'DELETE',
    url: '/folders/:folderId',
    config: { rateLimit: notebooksRateLimit },
    schema: {
      tags: ['notebooks'],
      summary: 'Delete an empty folder by id',
      params: {
        type: 'object',
        additionalProperties: false,
        required: ['folderId'],
        properties: { folderId: { type: 'string', format: 'uuid' } },
      },
      response: {
        204: { type: 'null' },
        409: {
          type: 'object',
          additionalProperties: false,
          required: ['message', 'code'],
          properties: {
            message: { type: 'string' },
            code: { type: 'string' },
          },
        },
      },
    },
    handler: async function deleteFolderHandler(request, reply) {
      await request.notebooksDataSource.deleteFolder(request.params.folderId)
      reply.code(204).send()
    },
  })
}

module.exports.autoPrefix = '/notebooks'
