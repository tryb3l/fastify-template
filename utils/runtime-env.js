'use strict'

function resolveNodeEnv(fastify, opts) {
  return (
    opts?.configData?.NODE_ENV ||
    fastify?.config?.NODE_ENV ||
    fastify?.secrets?.NODE_ENV ||
    process.env.NODE_ENV
  )
}

module.exports = {
  resolveNodeEnv,
}
