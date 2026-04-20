async function noteSchemasLoader(fastify) {
  const schemas = [
    './list-query.json',
    './list-item.json',
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
    fastify.log.debug(`Note schema added: ${schema.$id}`);
  }
  fastify.log.debug('Note schemas loaded');
}

module.exports = {
  noteSchemasLoader
};