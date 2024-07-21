'use strict'

const fastifyMultipart = require('@fastify/multipart')
const { parse: csvParse } = require('csv-parse')
const { stringify: csvStringify } = require('csv-stringify')

module.exports = async function fileNoteRoutes(fastify) {
  await fastify.register(fastifyMultipart, {
    attachFieldsToBody: 'keyValues',
    async onFile(part) {
      const lines = []

      const stream = part.file.pipe(
        csvParse({
          bom: true,
          skip_empty_lines: true,
          trim: true,
          columns: true,
        }),
      )

      for await (const line of stream) {
        lines.push({
          title: line.title,
          done: line.done === 'true',
        })
      }

      part.value = lines
    },
    sharedSchemaId: 'schema:note:import:file',
    limits: {
      fieldNameSize: 50,
      fieldSize: 100,
      fields: 10,
      fileSize: 10_000_000, // The max file size in bytes (10MB)
      files: 1,
    },
  })
  fastify.addHook('onRequest', fastify.authenticate)

  fastify.route({
    method: 'POST',
    url: '/import',
    schema: {
      tags: ['files'],
      summary: 'Import a note list from a CSV file',
      body: {
        type: 'object',
        required: ['noteListFile'],
        description: 'Import a note list from a CSV file with the following format: title,done',
        properties: {
          noteListFile: {
            type: 'array',
            items: {
              type: 'object',
              required: ['title', 'done'],
              properties: {
                title: { type: 'string' },
                done: { type: 'boolean' },
              },
            },
          },
        },
      },
      response: {
        201: {
          type: 'array',
          items: fastify.getSchema('schema:note:create:response'),
        },
      },
    },
    handler: async function listNotes(request, reply) {
      const inserted = await request.notesDataSource.createNotes(request.body.noteListFile)
      reply.code(201)
      return inserted
    },
  })

  fastify.route({
    method: 'GET',
    url: '/export',
    schema: {
      tags: ['files'],
      summary: 'Export a note list to a CSV file',
      querystring: fastify.getSchema('schema:note:list:export'),
    },
    handler: async function listNotes(request, reply) {
      const { title } = request.query
      const cursor = await request.todosDataSource.listNotes({
        filter: { title },
        skip: 0,
        limit: undefined,
        asStream: true,
      })
      reply.header('Content-Disposition', 'attachment; filename="note-list.csv"')
      reply.type('text/csv')
      return cursor.pipe(
        csvStringify({
          quoted_string: true,
          header: true,
          columns: ['title', 'done', 'createdAt', 'updatedAt', 'id'],
          cast: {
            boolean: (value) => (value ? 'true' : 'false'),
            date: (value) => value.toISOString(),
          },
        }),
      )
    },
  })
}
