'use strict'

const fs = require('node:fs')
const { mkdir, unlink } = require('node:fs/promises')
const { compose } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const fastifyMultipart = require('@fastify/multipart')
const path = require('node:path')
const { parse: csvParse } = require('csv-parse')
const { stringify: csvStringify } = require('csv-stringify')
const { randomUUIDv7 } = require('node:crypto')
const {
  CSV_IMPORT_BATCH_SIZE,
  buildNoteImportHeaders,
  mapNoteImportRow,
} = require('../../../utils/notes-csv')
const {
  ALLOWED_UPLOAD_MIME_TYPES,
  assertUploadedFileContent,
} = require('../../../utils/upload-verifier')
const { NOTE_EXPORT_PROJECTION } = require('../query-shapes')

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

// Returns the most precise mtime token available.
// Prefers Temporal.Instant.epochNanoseconds (Node 26.2+) and falls back to
// mtimeMs so the file stays runnable on Node >=26.0 without a hard engines bump.
function getStatsMtimeToken(fileStats) {
  if (fileStats.mtimeInstant !== undefined) {
    return String(fileStats.mtimeInstant.epochNanoseconds)
  }
  return String(fileStats.mtimeMs)
}

// Builds a weak ETag from size + mtime token.
// Including size guards against a file replacement that reuses the same mtime bucket.
function buildAttachmentEtag(fileStats) {
  return `W/"${fileStats.size}-${getStatsMtimeToken(fileStats)}"`
}

// Weak ETag comparison per RFC 9110 §13.1.2.
// Returns true when the response ETag matches and a 304 is appropriate.
function doesIfNoneMatch(header, etag) {
  if (!header) return false
  if (header.trim() === '*') return true
  const normalise = (v) => v.replace(/^W\//, '').replace(/^"|"$/g, '')
  const target = normalise(etag)
  return header.split(',').some((c) => normalise(c.trim()) === target)
}

// If-Modified-Since fallback per RFC 9110 §13.1.3.
// Returns true when the resource has NOT been modified since the header date.
// HTTP date strings (RFC 7231) are not ISO 8601, so Date.parse is the only
// option for the header. The mtime side prefers Temporal.Instant (Node 26.2+),
// and the comparison uses seconds because HTTP dates do not carry milliseconds.
function isNotModifiedSince(header, fileStats) {
  if (!header) return false
  const since = Date.parse(header)
  if (Number.isNaN(since)) return false
  const mtimeMs =
    fileStats.mtimeInstant !== undefined
      ? fileStats.mtimeInstant.epochMilliseconds
      : fileStats.mtime.getTime()
  return Math.floor(mtimeMs / 1000) <= Math.floor(since / 1000)
}

// Strips characters that are unsafe inside a quoted Content-Disposition filename:
// CR, LF, NUL, double-quotes, and backslashes. Uses basename to prevent path traversal.
function sanitizeContentDispositionFilename(name) {
  let hasSafeVisibleCharacter = false
  const safeName = Array.from(path.basename(String(name ?? '')), (char) => {
    if (
      char === '\\' ||
      char === '\r' ||
      char === '\n' ||
      char === '"' ||
      char.charCodeAt(0) === 0
    ) {
      return '_'
    }

    if (char.trim() !== '') {
      hasSafeVisibleCharacter = true
    }

    return char
  })
    .join('')
    .trim()

  return hasSafeVisibleCharacter && safeName ? safeName : 'attachment'
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

      const insertedIds = []
      let pendingNotes = []
      let headers
      let rowNumber = 0

      const flushPendingNotes = async () => {
        if (pendingNotes.length === 0) {
          return
        }

        const batchIds = await this.notesDataSource.createNotes(pendingNotes, request.user._id)
        insertedIds.push(...batchIds)
        pendingNotes = []
      }

      const stream = data.file.pipe(
        csvParse({
          bom: true,
          skip_empty_lines: true,
          trim: true,
        }),
      )

      try {
        for await (const line of stream) {
          if (!headers) {
            headers = buildNoteImportHeaders(line)
            continue
          }

          rowNumber += 1
          pendingNotes.push(mapNoteImportRow(headers, line, rowNumber))

          if (pendingNotes.length >= CSV_IMPORT_BATCH_SIZE) {
            await flushPendingNotes()
          }
        }
      } catch (err) {
        if (err.statusCode === 400 || err.code?.startsWith('CSV_')) {
          throw this.httpErrors.badRequest(err.message)
        }

        throw err
      }

      if (!headers) {
        throw this.httpErrors.badRequest('CSV must include a header row')
      }

      await flushPendingNotes()

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
          projection: NOTE_EXPORT_PROJECTION,
          skip: 0,
          limit: 0,
          asStream: true,
        },
        request.user._id,
      )

      reply.header('Content-Disposition', 'attachment; filename="note-list.csv"')
      reply.type('text/csv')

      return reply.send(
        compose(
          cursorStream,
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
        ),
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

        const safeFilename = randomUUIDv7() + ext
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
          await pipeline(part.file, fs.createWriteStream(filePath))
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
          request.log.warn(
            { err, filename: part.filename },
            'Uploaded file content verification failed',
          )
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

      let fileStats
      try {
        fileStats = await fs.promises.stat(filePath)
      } catch {
        throw this.httpErrors.notFound('File not found on disk')
      }

      const etag = buildAttachmentEtag(fileStats)
      const lastModified = fileStats.mtime.toUTCString()

      reply.header('ETag', etag)
      reply.header('Last-Modified', lastModified)
      reply.header('Cache-Control', 'private, no-cache')

      const ifNoneMatch = request.headers['if-none-match']
      if (ifNoneMatch) {
        if (doesIfNoneMatch(ifNoneMatch, etag)) {
          return reply.code(304).send()
        }
      } else if (isNotModifiedSince(request.headers['if-modified-since'], fileStats)) {
        return reply.code(304).send()
      }

      const safeFilename = sanitizeContentDispositionFilename(attachment.originalFilename)
      const stream = fs.createReadStream(filePath)

      reply.header('Content-Disposition', `attachment; filename="${safeFilename}"`)
      reply.type(attachment.mimeType)

      return reply.send(stream)
    },
  })
}

module.exports.autoPrefix = '/files'
