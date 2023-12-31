/**
 * Loads the configuration for the Fastify application.
 *
 * @param {FastifyInstance} fastify - The Fastify instance.
 * @param {Object} opts - The options object.
 * @returns {Promise<void>} - A promise that resolves when the configuration is loaded.
 */
module.exports = fp(async function configLoader(fastify, opts) {
  await fastify.register(fastifyEnv, {
    confKey: "secrets",
    schema: fastify.getSchema("schema:dotenv"),
  });
  fastify.decorate("config", {
    mongo: {
      forceClose: true,
      url: fastify.secrets.MONGO_URL,
    },
  });
});
