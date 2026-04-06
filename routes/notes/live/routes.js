'use strict'

module.exports = async function liveNotesRoutes(fastify) {
  fastify.get('/:id', { 
    websocket: true,
    preHandler: async (req, reply) => {
      const noteId = req.params.id;
      const userId = req.user._id || req.user.id;
      try {
        await fastify.notesDataSource.readNote(noteId, userId);
      } catch (err) {
        // Whether the note doesn't exist or the user doesn't own it,
        // return 403 to avoid leaking note existence information
        throw fastify.httpErrors.forbidden('Access to this live feed is forbidden');
      }
    }
  }, (socket, req) => {
    const noteId = req.params.id;

    fastify.log.info({ noteId }, 'Client connected to Live Note broadcast feed');

    const eventHandler = (payload) => {
      if (socket.readyState === 1) { // 1 === OPEN
        socket.send(JSON.stringify(payload));
      }
    };

    fastify.eventBus.on(`note_updated:${noteId}`, eventHandler);

    let lastValidation = Date.now()

    socket.on('message', async message => {
      if (message.toString() === 'ping') {
        const now = Date.now()
        // Rate-limit database authorization checks to once per 60 seconds per socket
        if (now - lastValidation > 60000) {
          try {
            const userId = req.user._id || req.user.id
            const user = await fastify.usersDataSource.readUserById(userId)
            if (!user || user.deleted) {
              socket.close(1008, 'Session Revoked')
              return
            }
            lastValidation = now
          } catch (e) { /* transient database error, permit continuation until next interval */ }
        }
        
        socket.send('pong');
      }
    });

    socket.on('close', () => {
      fastify.log.info({ noteId }, 'Client disconnected from Live Network');
      fastify.eventBus.off(`note_updated:${noteId}`, eventHandler);
    });
  });
}
