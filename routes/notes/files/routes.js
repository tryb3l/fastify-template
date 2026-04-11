'use strict'

const fs = require('node:fs')
const { mkdir, unlink } = require('node:fs/promises')
const { promisify } = require('node:util')
const { pipeline } = require('node:stream')
const pump = promisify(pipeline)
const fastifyMultipart = require('@fastify/multipart')
const path = require('node:path')
const { parse: csvParse } = require('csv-parse')
const { stringify: csvStringify } = require('csv-stringify')
const { randomUUID } = require('node:crypto')
const { ALLOWED_UPLOAD_MIME_TYPES, assertUploadedFileContent } = require('../../../utils/upload-verifier')

const DANGEROUS_CSV_PREFIX = /^[\t\r\n ]*[=+\-@]/

function sanitizeCsvCellValue(value) {
  if (typeof value !== 'string') {
    return value
  }

  // Prefix spreadsheet-formula-like cells at export time; this keeps stored note data intact
  // but intentionally changes emitted CSV values so spreadsheet apps do not execute formulas.
  if (DANGEROUS_CSV_PREFIX.test(value)) {
    return `'${value}`
  }

  return value
}

module.exports = async function fileRoutes(fastify) {
  await fastify.register(fastifyMultipart, {
    limits: {
      fieldNameSize: 50,
      fieldSize: 100,
      fields: 10,
      fileSize: 10_000_000, // 10MB limit
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
      response: {
        201: {
          type: 'array',
          items: { type: 'string', format: 'uuid' },
        },
      },
    },
    handler: async function importNotes(request, reply) {
      const data = await request.file()
      if (!data) throw this.httpErrors.badRequest('Missing file')

      const lines = []

      const stream = data.file.pipe(
        csvParse({
          bom: true,
          skip_empty_lines: true,
          trim: true,
          relax_column_count: true,
        }),
      )

      let isHeaderRow = true

      for await (const line of stream) {
        if (isHeaderRow) {
          isHeaderRow = false
          continue
        }

        const [title, body, ...tags] = line

        lines.push({
          title,
          body,
          tags,
        })
      }

      const insertedIds = await this.notesDataSource.createNotes(lines, request.user._id)

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
      const { title } = request.query

      const filter = {}
      if (title) filter.title = title

      const cursorStream = await this.notesDataSource.listNotes(
        {
          filter,
          skip: 0,
          asStream: true,
        },
        request.user._id,
      )

      reply.header('Content-Disposition', 'attachment; filename="note-list.csv"')
      reply.type('text/csv')

      return cursorStream.pipe(
        csvStringify({
          quoted_string: true,
          header: true,
          columns: ['title', 'body', 'tags', 'createdAt', 'modifiedAt', 'id'],
          cast: {
            date: (value) => value.toISOString(),
            object: (value) => sanitizeCsvCellValue(JSON.stringify(value)),
            string: (value) => sanitizeCsvCellValue(value),
          },
        }),
      )
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
      const userId = request.user._id || request.user.id
      const parts = request.parts()
      const uploadDir = './uploads'

      await mkdir(uploadDir, { recursive: true })
      await this.notesDataSource.readNote(noteId, userId)

      const uploadedFiles = []

      const cleanupUploadedFiles = async () => {
        for (const file of uploadedFiles) {
          if (file.filePath) {
            try {
              await unlink(file.filePath)
            } catch {
              /* ignore cleanup errors */
            }
          }
        }
      }

      for await (const part of parts) {
        if (!part.file) {
          continue
        }

        const ext = path.extname(part.filename).toLowerCase()
        const allowedExts = ALLOWED_UPLOAD_MIME_TYPES[part.mimetype]

        const isValid =
          allowedExts &&
          (Array.isArray(allowedExts) ? allowedExts.includes(ext) : allowedExts === ext)

        if (!isValid) {
          await cleanupUploadedFiles()
          throw this.httpErrors.unsupportedMediaType(
            `File type not allowed or extension mismatch: ${part.filename}`,
          )
        }

        const safeFilename = randomUUID() + ext
        const filePath = path.join(uploadDir, safeFilename)
        const fileId = safeFilename.slice(0, safeFilename.lastIndexOf('.'))
        const uploadedAt = new Date().toISOString()

        uploadedFiles.push({
          fileId,
          originalFilename: part.filename,
          mimeType: part.mimetype,
          size: 0,
          uploadedAt,
          filePath,
        })

        try {
          await pump(part.file, fs.createWriteStream(filePath))
        } catch (err) {
          request.log.error(err)
          await cleanupUploadedFiles()
          throw this.httpErrors.internalServerError('File upload failed')
        }

        if (part.file.truncated) {
          await cleanupUploadedFiles()
          throw this.httpErrors.badRequest('File is too large')
        }

        uploadedFiles[uploadedFiles.length - 1].size = Number(part.file.bytesRead || 0)

        try {
          await assertUploadedFileContent({
            filePath,
            filename: part.filename,
            mimeType: part.mimetype,
          })
        } catch (err) {
          request.log.warn({ err, filename: part.filename }, 'Uploaded file content verification failed')
          await cleanupUploadedFiles()

          if (err.statusCode === 400) {
            throw this.httpErrors.badRequest(err.message)
          }

          if (err.statusCode === 415) {
            throw this.httpErrors.unsupportedMediaType(err.message)
          }

          throw this.httpErrors.internalServerError('File upload failed')
        }
      }

      if (uploadedFiles.length === 0) {
        throw this.httpErrors.badRequest('No files uploaded')
      }

      const dbFiles = uploadedFiles.map((file) => ({
        fileId: file.fileId,
        originalFilename: file.originalFilename,
        mimeType: file.mimeType,
        size: file.size,
        uploadedAt: file.uploadedAt,
      }))

      try {
        await this.notesDataSource.addAttachments(noteId, dbFiles, userId)
      } catch (err) {
        request.log.error(err)
        await cleanupUploadedFiles()
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
    schema: {
      tags: ['files'],
      summary: 'Download an attachment',
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
        200: {
          type: 'object', // Streaming binary content
        },
      },
    },
    handler: async function downloadFile(request, reply) {
      const { fileId } = request.params
      const { noteId } = request.query
      const userId = request.user._id || request.user.id

      const note = await this.notesDataSource.readNote(noteId, userId)

      const attachment = (note.attachments || []).find((att) => att.fileId === fileId)
      if (!attachment) throw this.httpErrors.notFound('Attachment not found on this note')

      const ext = path.extname(attachment.originalFilename).toLowerCase()
      const filePath = path.join('./uploads', fileId + ext)

      try {
        await fs.promises.access(filePath, fs.constants.R_OK)
      } catch {
        throw this.httpErrors.notFound('File not found on disk')
      }

      const stream = fs.createReadStream(filePath)

      reply.header('Content-Disposition', `attachment; filename="${attachment.originalFilename}"`)
      reply.type(attachment.mimeType)

      return reply.send(stream)
    },
  })
}

module.exports.autoPrefix = '/files'
