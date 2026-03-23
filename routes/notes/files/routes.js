'use strict'

const fs = require('node:fs')
const { promisify } = require('node:util')
const { pipeline } = require('node:stream')
const pump = promisify(pipeline)
const fastifyMultipart = require('@fastify/multipart')
const path = require('node:path')
const { parse: csvParse } = require('csv-parse')
const { stringify: csvStringify } = require('csv-stringify')

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
          items: { type: 'string', format: 'uuid' }
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
        })
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

      const cursorStream = await this.notesDataSource.listNotes({
        filter,
        skip: 0,
        asStream: true,
      }, request.user._id)

      reply.header('Content-Disposition', 'attachment; filename="note-list.csv"')
      reply.type('text/csv')

      return cursorStream.pipe(
        csvStringify({
          quoted_string: true,
          header: true,
          columns: ['title', 'body', 'tags', 'createdAt', 'modifiedAt', 'id'],
          cast: {
            date: (value) => value.toISOString(),
            object: (value) => JSON.stringify(value),
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
    },
    handler: async function uploadFile(request, reply) {
      const parts = request.parts()
      const uploadDir = './uploads'

      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true })
      }

      try {
        for await (const part of parts) {
          if (part.file) {
            const filename = path.basename(part.filename)
            const filePath = path.join(uploadDir, filename)

            if (part.file.truncated) {
              throw this.httpErrors.badRequest('File is too large')
            }

            await pump(part.file, fs.createWriteStream(filePath))
          }
        }
        return { message: 'File uploaded successfully' }
      } catch (err) {
        request.log.error(err)
        throw this.httpErrors.internalServerError('File upload failed')
      }
    },
  })
}

module.exports.autoPrefix = '/files'