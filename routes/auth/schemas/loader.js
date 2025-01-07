'use strict'

const path = require('path')

async function authSchemasLoader(fastify) {
  console.log('Loading auth schemas')
  const schemas = [
    './register.json',
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
      console.log(`Auth schema added: ${schema.$id}`)
    }
    console.log('Auth schemas loaded')
  } catch (err) {
    console.error('Error loading auth schemas:', err)
    throw err
  }
}

module.exports = { authSchemasLoader }