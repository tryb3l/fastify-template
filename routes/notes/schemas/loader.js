// 'use strict'
//
// const fp = require('fastify-plugin')
//
// module.exports = fp(async function schemaLoaderPlugin(fastify) {
//   fastify.addSchema(require('./list-query.json'))
//   fastify.addSchema(require('./list-response.json'))
//   fastify.addSchema(require('./list-export.json'))
//   fastify.addSchema(require('./create-body.json'))
//   fastify.addSchema(require('./create-response.json'))
//   // fastify.addSchema(require('./status-params.json')) // You don't seem to use this schema
//   // fastify.addSchema(require('./status-response.json')) // You don't seem to use this schema
//   fastify.addSchema(require('./note.json'))
//   fastify.addSchema(require('./read-params.json'))
//   fastify.addSchema(require('./update-body.json'))
//   fastify.addSchema(require('../../../schemas/limit.json'))
//   fastify.addSchema(require('../../../schemas/skip.json'))
// }, { name: 'notes-schema-loader' })

async function noteSchemasLoader(fastify) {
  console.log('Loading note schemas');
  const schemas = [
    './list-query.json',
    './list-response.json',
    './list-export.json',
    './create-body.json',
    './create-response.json',
    './note.json',
    './read-params.json',
    './update-body.json',
    '../../../schemas/limit.json',
    '../../../schemas/skip.json',
  ];
  for (const schemaPath of schemas) {
    const schema = require(schemaPath);
    fastify.addSchema(schema);
    console.log(`Note schema added: ${schema.$id}`);
  }
  console.log('Note schemas loaded');
}

module.exports = {
  noteSchemasLoader
};