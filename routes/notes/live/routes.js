'use strict'

const PING_BUFFER = Buffer.from('ping')

function isPingMessage(message) {
  if (Buffer.isBuffer(message)) {
    return message.length === 4 && message.equals(PING_BUFFER)
  }
  return String(message) === 'ping'
}

module.exports = async function liveNotesRoutes(fastify) {
  fastify.get(
    '/:id',
    {
      websocket: true,
      preHandler: async (req) => {
        const noteId = req.params.id
        try {
          await req.notesDataSource.readNote(noteId)
        } catch {
          throw fastify.httpErrors.forbidden('Access to this live feed is forbidden')
        }
      },
    },
    (socket, req) => {
      const noteId = req.params.id

      fastify.log.info({ noteId }, 'Client connected to Live Note broadcast feed')

      const eventName = `note_updated:${noteId}`
      const eventHandler = (payload) => {
        if (socket.readyState === 1) {
          // 1 === OPEN
          socket.send(JSON.stringify(payload))
        }
      }

      let isCleanedUp = false
      const cleanup = () => {
        if (isCleanedUp) return
        isCleanedUp = true
        fastify.eventBus.off(eventName, eventHandler)
      }

      fastify.eventBus.on(eventName, eventHandler)

      let lastValidation = Date.now()
      let isValidating = false

      socket.on('message', async (message) => {
        if (isPingMessage(message)) {
          const now = Date.now()
          // Rate-limit database authorization checks to once per 60 seconds per socket
          if (now - lastValidation > 60000 && !isValidating) {
            isValidating = true
            try {
              const userId = req.user._id || req.user.id
              const user = await fastify.usersDataSource.readUserById(userId)
              if (!user || user.deleted) {
                socket.close(1008, 'Session Revoked')
                return
              }
              lastValidation = now
            } catch {
              /* transient database error, permit continuation until next interval */
            } finally {
              isValidating = false
            }
          }

          if (socket.readyState === 1) {
            socket.send('pong')
          }
        }
      })

      socket.on('error', (err) => {
        fastify.log.warn({ err, noteId }, 'Live Note WebSocket error')
        cleanup()
      })

      socket.on('close', () => {
        fastify.log.info({ noteId }, 'Client disconnected from Live Network')
        cleanup()
      })
    },
  )
}
