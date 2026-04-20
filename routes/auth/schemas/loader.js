'use strict'

const path = require('path')

async function authSchemasLoader(fastify) {
  fastify.log.debug('Loading auth schemas')
  const schemas = [
    './password-policy.json',
    './register.json',
    './reset-request.json',
    './reset-validate.json',
    './reset-confirm.json',
    './authenticate.json',
    './email.json',
    './firstname.json',
    './lastname.json',
    './password.json',
    './token-header.json',
    './token.json',
    './username.json',
    './user.json'
  ]

  try {
    for (const schemaPath of schemas) {
      const schema = require(path.resolve(__dirname, schemaPath))
      await fastify.addSchema(schema)
      fastify.log.debug(`Auth schema added: ${schema.$id}`)
    }
    fastify.log.debug('Auth schemas loaded')
  } catch (err) {
    fastify.log.error({ err }, 'Error loading auth schemas')
    throw err
  }
}

module.exports = { authSchemasLoader }