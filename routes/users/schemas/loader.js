// 'use strict'
//
// const fp = require('fastify-plugin')
//
// module.exports = fp(async function schemaLoaderPlugin(fastify) {
//   fastify.addSchema(require('./read-params.json'))
//   fastify.addSchema(require('./update-user.json'))
//   fastify.addSchema(require('./users-list-query.json'))
//   fastify.addSchema(require('./users-list-response.json'))
// }, { name: 'users-schema-loader' })
'use strict'

function loadUserSchemas(fastify) {
  console.log('Loading users schemas');
  const schemas = [
    './read-params.json',
    './update-user.json',
    './users-list-query.json',
    './users-list-response.json',
  ];
  for (const schemaPath of schemas) {
    const schema = require(schemaPath);
    fastify.addSchema(schema);
    console.log(`User schema added: ${schema.$id}`);
  }
  console.log('Users schemas loaded');
}

module.exports = { loadUserSchemas }