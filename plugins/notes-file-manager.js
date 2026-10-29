'use strict'

const fp = require('fastify-plugin')
const fs = require('node:fs')
const { mkdir, stat, unlink } = require('node:fs/promises')
const path = require('node:path')
const { pipeline } = require('node:stream/promises')
const { randomUUIDv7 } = require('node:crypto')
const { nowIsoInstantString } = require('../utils/time')
const { ALLOWED_UPLOAD_MIME_TYPES, assertUploadedFileContent } = require('../utils/upload-verifier')

function getStatsMtimeToken(fileStats) {
  if (fileStats.mtimeInstant !== undefined) {
    return String(fileStats.mtimeInstant.epochNanoseconds)
  }
  return String(fileStats.mtimeMs)
}

function buildAttachmentEtag(fileStats) {
  return `W/"${fileStats.size}-${getStatsMtimeToken(fileStats)}"`
}

function doesIfNoneMatch(header, etag) {
  if (!header) return false
  if (header.trim() === '*') return true
  const normalise = (v) => v.replace(/^W\//, '').replace(/^"|"$/g, '')
  const target = normalise(etag)
  return header.split(',').some((c) => normalise(c.trim()) === target)
}

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

// Strips characters that are unsafe inside a quoted Content-Disposition filename.
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

module.exports = fp(
  async function notesFileManagerPlugin(fastify) {
    fastify.log.info('Starting registration of notes-file-manager plugin')

    const uploadDir = fastify.config?.UPLOAD_DIR || './uploads'

    function resolveAttachmentPath(fileId, originalFilename) {
      const ext = path.extname(String(originalFilename || '')).toLowerCase()
      const safeBasename = path.basename(`${fileId}${ext}`)
      return path.join(uploadDir, safeBasename)
    }

    const notesFileManager = {
      uploadDir,
      resolveAttachmentPath,

      async stageUploads(parts, logger = fastify.log) {
        await mkdir(uploadDir, { recursive: true })

        const uploadedFiles = []

        const cleanup = async () => {
          await Promise.all(
            uploadedFiles.map(async (file) => {
              if (file.filePath) {
                await unlink(file.filePath).catch(() => {})
              }
            }),
          )
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
            await cleanup()
            throw fastify.httpErrors.unsupportedMediaType(
              `File type not allowed or extension mismatch: ${part.filename}`,
            )
          }

          const safeFilename = randomUUIDv7() + ext
          const filePath = path.join(uploadDir, path.basename(safeFilename))
          const fileId = safeFilename.slice(0, safeFilename.lastIndexOf('.'))
          const uploadedAt = nowIsoInstantString()

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
            logger.error(err)
            await cleanup()
            throw fastify.httpErrors.internalServerError('File upload failed')
          }

          if (part.file.truncated) {
            await cleanup()
            throw fastify.httpErrors.badRequest('File is too large')
          }

          uploadedFiles[uploadedFiles.length - 1].size = Number(part.file.bytesRead || 0)

          try {
            await assertUploadedFileContent({
              filePath,
              filename: part.filename,
              mimeType: part.mimetype,
            })
          } catch (err) {
            logger.warn(
              { err, filename: part.filename },
              'Uploaded file content verification failed',
            )
            await cleanup()

            if (err.statusCode === 400) {
              throw fastify.httpErrors.badRequest(err.message)
            }

            if (err.statusCode === 415) {
              throw fastify.httpErrors.unsupportedMediaType(err.message)
            }

            throw fastify.httpErrors.internalServerError('File upload failed')
          }
        }

        if (uploadedFiles.length === 0) {
          throw fastify.httpErrors.badRequest('No files uploaded')
        }

        const dbFiles = uploadedFiles.map((file) => ({
          fileId: file.fileId,
          originalFilename: file.originalFilename,
          mimeType: file.mimeType,
          size: file.size,
          uploadedAt: file.uploadedAt,
        }))

        return { dbFiles, cleanup }
      },

      async deleteNoteAttachments(attachments) {
        if (!Array.isArray(attachments) || attachments.length === 0) {
          return
        }

        await Promise.all(
          attachments.map(async (att) => {
            if (!att || !att.fileId) return
            const filePath = resolveAttachmentPath(att.fileId, att.originalFilename)
            await unlink(filePath).catch(() => {})
          }),
        )
      },

      async resolveAttachmentDownload(note, fileId, requestHeaders = {}) {
        const attachment = (note.attachments || []).find((att) => att.fileId === fileId)
        if (!attachment) {
          throw fastify.httpErrors.notFound('Attachment not found on this note')
        }

        const filePath = resolveAttachmentPath(fileId, attachment.originalFilename)

        let fileStats
        try {
          fileStats = await stat(filePath)
        } catch {
          throw fastify.httpErrors.notFound('File not found on disk')
        }

        const etag = buildAttachmentEtag(fileStats)
        const lastModified = fileStats.mtime.toUTCString()
        const safeFilename = sanitizeContentDispositionFilename(attachment.originalFilename)

        const ifNoneMatch = requestHeaders['if-none-match']
        const notModified = ifNoneMatch
          ? doesIfNoneMatch(ifNoneMatch, etag)
          : isNotModifiedSince(requestHeaders['if-modified-since'], fileStats)

        return {
          attachment,
          etag,
          lastModified,
          safeFilename,
          notModified,
          createStream: () => fs.createReadStream(filePath),
        }
      },
    }

    fastify.decorate('notesFileManager', notesFileManager)
    fastify.log.info('Successfully registered notes-file-manager plugin')
  },
  {
    name: 'notes-file-manager',
    dependencies: ['application-config'],
    decorators: {
      fastify: ['config'],
    },
  },
)

module.exports.buildAttachmentEtag = buildAttachmentEtag
module.exports.doesIfNoneMatch = doesIfNoneMatch
module.exports.isNotModifiedSince = isNotModifiedSince
module.exports.sanitizeContentDispositionFilename = sanitizeContentDispositionFilename
