'use strict'

const fp = require('fastify-plugin')
const fastifyWebsocket = require('@fastify/websocket')
const { EventEmitter } = require('node:events')

module.exports = fp(async function websocketPlugin(fastify, opts) {
  fastify.log.info('Starting registration of websocket plugin')

  await fastify.register(fastifyWebsocket, {
    options: { maxPayload: 1048576 } // 1MB payload ceiling
  })

  const eventBus = new EventEmitter()
  eventBus.setMaxListeners(0) // Remove memory leak warnings for dynamic sockets

  fastify.decorate('eventBus', eventBus)

  fastify.log.info('Successfully registered websocket and Global EventBus')
}, {
  name: 'websocket-plugin'
})
