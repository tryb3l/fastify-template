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