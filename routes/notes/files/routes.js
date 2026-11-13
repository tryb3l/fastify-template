'use strict'

const fastifyMultipart = require('@fastify/multipart')
const { createNotesCsvExportStream, importNotesFromCsvStream } = require('../../../utils/notes-csv')
const { NOTE_EXPORT_PROJECTION } = require('../query-shapes')

module.exports = async function fileRoutes(fastify) {
  const maxUploadBytes = Number(fastify.config?.MAX_UPLOAD_BYTES || 10_000_000)
  const userStorageQuotaBytes = Number(fastify.config?.USER_STORAGE_QUOTA_BYTES || 524_288_000)

  await fastify.register(fastifyMultipart, {
    limits: {
      fieldNameSize: 50,
      fieldSize: 100,
      fields: 10,
      fileSize: maxUploadBytes,
      files: 1,
    },
  })

  fastify.route({
    method: 'POST',
    url: '/import',
    schema: {
      tags: ['files'],
      summary: 'Import a note list from a CSV file',
      consumes: ['multipart/form-data'],
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          notebookId: { type: 'string', format: 'uuid' },
          folderId: { type: 'string', format: 'uuid' },
        },
      },
      response: {
        201: {
          type: 'array',
          items: { type: 'string', format: 'uuid' },
        },
      },
    },
    handler: async function importNotes(request, reply) {
      const { notebookId = null, folderId = null } = request.query || {}
      if (notebookId !== null || folderId !== null) {
        await request.notebooksDataSource.verifyContainerPlacement({ notebookId, folderId })
      }

      const data = await request.file()
      if (!data) throw this.httpErrors.badRequest('Missing file')

      const insertedIds = await importNotesFromCsvStream(data.file, (batch) =>
        request.notesDataSource.createNotes(batch, { notebookId, folderId }),
      )

      return reply.code(201).send(insertedIds)
    },
  })

  fastify.route({
    method: 'GET',
    url: '/export',
    schema: {
      tags: ['files'],
      summary: 'Export a note list to a CSV file',
      querystring: { $ref: 'schema:note:list:export#' },
    },
    handler: async function exportNotes(request, reply) {
      const { title, notebookId, folderId, inbox } = request.query

      const filter = {}
      if (title) filter.title = title
      if (inbox === true) {
        filter.notebookId = null
        filter.folderId = null
      } else {
        if (notebookId !== undefined) filter.notebookId = notebookId
        if (folderId !== undefined) filter.folderId = folderId
      }

      const cursorStream = await request.notesDataSource.listNotes({
        filter,
        projection: NOTE_EXPORT_PROJECTION,
        skip: 0,
        limit: 0,
        asStream: true,
      })

      reply.header('Content-Disposition', 'attachment; filename="note-list.csv"')
      reply.type('text/csv')

      return reply.send(createNotesCsvExportStream(cursorStream))
    },
  })

  fastify.route({
    method: 'POST',
    url: '/upload',
    schema: {
      tags: ['files'],
      summary: 'Upload a raw file',
      consumes: ['multipart/form-data'],
      querystring: {
        type: 'object',
        required: ['noteId'],
        additionalProperties: false,
        properties: {
          noteId: { type: 'string', format: 'uuid' },
        },
      },
      response: {
        201: {
          type: 'object',
          additionalProperties: false,
          properties: {
            message: { type: 'string' },
            files: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  fileId: { type: 'string', format: 'uuid' },
                  originalFilename: { type: 'string' },
                  mimeType: { type: 'string' },
                  size: { type: 'integer', minimum: 0 },
                  uploadedAt: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
      },
    },
    handler: async function uploadFile(request, reply) {
      const { noteId } = request.query

      await request.notesDataSource.readNote(noteId)

      const { dbFiles, cleanup } = await fastify.notesFileManager.stageUploads(
        request.parts(),
        request.log,
      )

      try {
        const batchBytes = dbFiles.reduce((acc, f) => acc + Number(f.size || 0), 0)
        const currentUsageBytes = await request.notesDataSource.getUserStorageUsageBytes()
        if (currentUsageBytes + batchBytes > userStorageQuotaBytes) {
          await cleanup()
          throw fastify.httpErrors.payloadTooLarge('User storage quota exceeded')
        }

        await request.notesDataSource.addAttachments(noteId, dbFiles)
      } catch (err) {
        request.log.error(err)
        await cleanup()
        if (err.statusCode) {
          throw err
        }
        throw this.httpErrors.internalServerError('File upload failed')
      }

      reply.code(201)
      return { message: 'Files uploaded successfully', files: dbFiles }
    },
  })

  fastify.route({
    method: 'GET',
    url: '/:fileId',
    compress: false,
    schema: {
      tags: ['files'],
      summary: 'Download or stream an attachment (supports HTTP Range)',
      params: {
        type: 'object',
        required: ['fileId'],
        properties: {
          fileId: { type: 'string', format: 'uuid' },
        },
      },
      querystring: {
        type: 'object',
        required: ['noteId'],
        properties: {
          noteId: { type: 'string', format: 'uuid' },
        },
      },
      response: {
        416: {
          type: 'object',
          additionalProperties: false,
          required: ['statusCode', 'error', 'message'],
          properties: {
            statusCode: { type: 'integer' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    handler: async function downloadFile(request, reply) {
      const { fileId } = request.params
      const { noteId } = request.query

      const note = await request.notesDataSource.readNote(noteId)
      const download = await fastify.notesFileManager.resolveAttachmentDownload(
        note,
        fileId,
        request.headers,
      )

      reply.header('ETag', download.etag)
      reply.header('Last-Modified', download.lastModified)
      reply.header('Cache-Control', 'private, no-cache')
      reply.header('Accept-Ranges', 'bytes')

      if (download.notModified) {
        return reply.code(304).send()
      }

      if (download.range) {
        if (!download.range.satisfiable) {
          reply.header('Content-Range', `bytes */${download.totalSize}`)
          return reply.code(416).send({
            statusCode: 416,
            error: 'Range Not Satisfiable',
            message: 'Requested byte range is not satisfiable',
          })
        }

        reply.header('Content-Disposition', `attachment; filename="${download.safeFilename}"`)
        reply.header('Content-Range', download.range.contentRange)
        reply.header('Content-Length', download.range.contentLength)
        reply.type(download.attachment.mimeType)

        return reply
          .code(206)
          .send(download.createStream({ start: download.range.start, end: download.range.end }))
      }

      reply.header('Content-Disposition', `attachment; filename="${download.safeFilename}"`)
      reply.header('Content-Length', download.totalSize)
      reply.type(download.attachment.mimeType)

      return reply.send(download.createStream())
    },
  })

  fastify.route({
    method: 'DELETE',
    url: '/:fileId',
    schema: {
      tags: ['files'],
      summary: 'Delete an individual attachment from a note',
      params: {
        type: 'object',
        required: ['fileId'],
        additionalProperties: false,
        properties: {
          fileId: { type: 'string', format: 'uuid' },
        },
      },
      querystring: {
        type: 'object',
        required: ['noteId'],
        additionalProperties: false,
        properties: {
          noteId: { type: 'string', format: 'uuid' },
        },
      },
      response: {
        204: { type: 'null' },
      },
    },
    handler: async function deleteFile(request, reply) {
      const { fileId } = request.params
      const { noteId } = request.query

      await request.notesDataSource.removeAttachment(noteId, fileId)
      reply.code(204).send()
    },
  })
}

module.exports.autoPrefix = '/files'
