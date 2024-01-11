"use strict";

const fp = require("fastify-plugin");

const generateHash = require("./generate-hash");

module.exports.prefixOverride = "";

module.exports = fp(async function applicationAuth(fastify, opts) {
  fastify.post("/register", {
    schema: {
      body: fastify.getSchema("schema:auth:register"),
    },
    handler: async function registerHandler(request, reply) {
      const existingUser = await this.usersDataSource.readUser(
        request.body.username,
      );
      if (existingUser) {
        const err = new Error("User already registered");
        err.statusCode = 409;
        throw err;
      }
      const { hash, salt } = await generateHash(request.body.password);

      try {
        const newUserId = await this.usersDataSource.createUser({
          username: request.body.username,
          salt,
          hash,
        });
        request.log.info({ userId: newUserId }, "User registered");

        reply.code(201);
        return { registered: true };
      } catch (error) {
        request.log.error(error, "Failed to register user");
        reply.code(500);
        return { registered: false };
      }
    },
  });
});
