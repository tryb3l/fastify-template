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

function parseByteRangeHeader(rangeHeader, totalSize) {
  if (!rangeHeader || typeof rangeHeader !== 'string') {
    return null
  }

  const trimmed = rangeHeader.trim()
  if (!trimmed.startsWith('bytes=')) {
    return { satisfiable: false }
  }

  const spec = trimmed.slice('bytes='.length).trim()
  if (spec.includes(',')) {
    return { satisfiable: false }
  }

  const match = /^(\d*)-(\d*)$/.exec(spec)
  if (!match || (match[1] === '' && match[2] === '')) {
    return { satisfiable: false }
  }

  if (totalSize === 0) {
    return { satisfiable: false }
  }

  let start
  let end

  if (match[1] === '') {
    const suffixLength = Number(match[2])
    if (Number.isNaN(suffixLength) || suffixLength <= 0) {
      return { satisfiable: false }
    }
    start = Math.max(0, totalSize - suffixLength)
    end = totalSize - 1
  } else {
    start = Number(match[1])
    end = match[2] === '' ? totalSize - 1 : Number(match[2])
    if (Number.isNaN(start) || Number.isNaN(end) || start >= totalSize || start > end) {
      return { satisfiable: false }
    }
    end = Math.min(end, totalSize - 1)
  }

  return {
    satisfiable: true,
    start,
    end,
    contentLength: end - start + 1,
    contentRange: `bytes ${start}-${end}/${totalSize}`,
  }
}

function createLocalDiskStorageProvider(uploadDir) {
  function resolveKeyPath(key) {
    return path.join(uploadDir, path.basename(String(key)))
  }

  return {
    uploadDir,
    resolveKeyPath,
    async putStream(key, readableStream) {
      await mkdir(uploadDir, { recursive: true })
      const filePath = resolveKeyPath(key)
      await pipeline(readableStream, fs.createWriteStream(filePath))
      return filePath
    },
    getStream(key, options = {}) {
      const filePath = resolveKeyPath(key)
      const streamOpts = {}
      if (typeof options.start === 'number') streamOpts.start = options.start
      if (typeof options.end === 'number') streamOpts.end = options.end
      return fs.createReadStream(filePath, streamOpts)
    },
    async stat(key) {
      const filePath = resolveKeyPath(key)
      return await stat(filePath)
    },
    async delete(key) {
      const filePath = resolveKeyPath(key)
      await unlink(filePath).catch(() => {})
    },
  }
}

module.exports = fp(
  async function notesFileManagerPlugin(fastify) {
    fastify.log.info('Starting registration of notes-file-manager plugin')

    const uploadDir = fastify.config?.UPLOAD_DIR || './uploads'
    const storageProvider = createLocalDiskStorageProvider(uploadDir)

    function resolveAttachmentKey(fileId, originalFilename) {
      const ext = path.extname(String(originalFilename || '')).toLowerCase()
      return path.basename(`${fileId}${ext}`)
    }

    function resolveAttachmentPath(fileId, originalFilename) {
      return storageProvider.resolveKeyPath(resolveAttachmentKey(fileId, originalFilename))
    }

    const notesFileManager = {
      uploadDir,
      storageProvider,
      resolveAttachmentPath,

      async stageUploads(parts, logger = fastify.log) {
        await mkdir(uploadDir, { recursive: true })

        const uploadedFiles = []

        const cleanup = async () => {
          await Promise.all(
            uploadedFiles.map(async (file) => {
              if (file.storageKey) {
                await storageProvider.delete(file.storageKey)
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
          const storageKey = path.basename(safeFilename)
          const fileId = safeFilename.slice(0, safeFilename.lastIndexOf('.'))
          const uploadedAt = nowIsoInstantString()
          let filePath = storageProvider.resolveKeyPath(storageKey)

          uploadedFiles.push({
            fileId,
            originalFilename: part.filename,
            mimeType: part.mimetype,
            size: 0,
            uploadedAt,
            storageKey,
            filePath,
          })

          try {
            filePath = await storageProvider.putStream(storageKey, part.file)
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
            const storageKey = resolveAttachmentKey(att.fileId, att.originalFilename)
            await storageProvider.delete(storageKey)
          }),
        )
      },

      async resolveAttachmentDownload(note, fileId, requestHeaders = {}) {
        const attachment = (note.attachments || []).find((att) => att.fileId === fileId)
        if (!attachment) {
          throw fastify.httpErrors.notFound('Attachment not found on this note')
        }

        const storageKey = resolveAttachmentKey(fileId, attachment.originalFilename)

        let fileStats
        try {
          fileStats = await storageProvider.stat(storageKey)
        } catch {
          throw fastify.httpErrors.notFound('File not found on disk')
        }

        const totalSize = Number(fileStats.size || 0)
        const etag = buildAttachmentEtag(fileStats)
        const lastModified = fileStats.mtime.toUTCString()
        const safeFilename = sanitizeContentDispositionFilename(attachment.originalFilename)

        const ifNoneMatch = requestHeaders['if-none-match']
        const notModified = ifNoneMatch
          ? doesIfNoneMatch(ifNoneMatch, etag)
          : isNotModifiedSince(requestHeaders['if-modified-since'], fileStats)

        const rangeHeader = requestHeaders.range || requestHeaders.Range
        const range = parseByteRangeHeader(rangeHeader, totalSize)

        return {
          attachment,
          totalSize,
          etag,
          lastModified,
          safeFilename,
          notModified,
          range,
          createStream: (rangeOpts = {}) => storageProvider.getStream(storageKey, rangeOpts),
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
module.exports.parseByteRangeHeader = parseByteRangeHeader
