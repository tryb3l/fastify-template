'use strict'

const PING_BUFFER = Buffer.from('ping')
const SESSION_REVALIDATION_INTERVAL_MS = 60_000

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
      const userId = req.user?._id || req.user?.id
      const initialCredentialsVersion = req.user?.credentialsVersion ?? 0
      const accessTokenExpMs =
        typeof req.accessTokenExp === 'number'
          ? req.accessTokenExp
          : typeof req.user?.exp === 'number'
            ? req.user.exp * 1000
            : null

      fastify.log.info({ noteId }, 'Client connected to Live Note broadcast feed')

      let isCleanedUp = false
      let inflightValidation = null
      let lastValidation = Date.now()

      const validateSocketSession = () => {
        if (accessTokenExpMs !== null && Date.now() >= accessTokenExpMs) {
          return Promise.resolve(false)
        }

        if (inflightValidation !== null) {
          return inflightValidation
        }

        inflightValidation = (async () => {
          try {
            const user = await fastify.usersDataSource.readUserById(userId)
            if (!user || user.deleted) {
              return false
            }

            if ((user.credentialsVersion ?? 0) !== initialCredentialsVersion) {
              return false
            }

            lastValidation = Date.now()
            return true
          } finally {
            inflightValidation = null
          }
        })()

        return inflightValidation
      }

      const revokeSocket = (reason = 'Session Revoked') => {
        if (socket.readyState === 1) {
          socket.close(1008, reason)
        }
        cleanup()
      }

      const eventName = `note_updated:${noteId}`
      const deletedEventName = `note_deleted:${noteId}`

      const eventHandler = async (payload, serializedPayload) => {
        if (socket.readyState !== 1) {
          return
        }

        try {
          const valid = await validateSocketSession()
          if (!valid) {
            revokeSocket('Session Revoked')
            return
          }
        } catch {
          return
        }

        if (socket.readyState === 1) {
          // 1 === OPEN
          socket.send(
            typeof serializedPayload === 'string' ? serializedPayload : JSON.stringify(payload),
          )
        }
      }

      const deletedEventHandler = () => {
        revokeSocket('Note Deleted')
      }

      const revalidationTimer = setInterval(async () => {
        if (isCleanedUp || inflightValidation !== null || socket.readyState !== 1) {
          return
        }
        try {
          const valid = await validateSocketSession()
          if (!valid) {
            revokeSocket('Session Revoked')
          }
        } catch {
          /* transient database error, permit continuation until next interval */
        }
      }, SESSION_REVALIDATION_INTERVAL_MS)
      revalidationTimer.unref?.()

      function cleanup() {
        if (isCleanedUp) return
        isCleanedUp = true
        clearInterval(revalidationTimer)
        fastify.eventBus.off(eventName, eventHandler)
        fastify.eventBus.off(deletedEventName, deletedEventHandler)
      }

      fastify.eventBus.on(eventName, eventHandler)
      fastify.eventBus.on(deletedEventName, deletedEventHandler)

      socket.on('message', async (message) => {
        if (isPingMessage(message)) {
          const now = Date.now()
          // Rate-limit database authorization checks to once per 60 seconds per socket
          if (now - lastValidation > SESSION_REVALIDATION_INTERVAL_MS) {
            try {
              const valid = await validateSocketSession()
              if (!valid) {
                revokeSocket('Session Revoked')
                return
              }
            } catch {
              /* transient database error, permit continuation until next interval */
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
