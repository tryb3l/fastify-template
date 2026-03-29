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
  }, (connection, req) => {
    const noteId = req.params.id;

    fastify.log.info({ noteId }, 'Client connected to Live Note broadcast feed');

    const eventHandler = (payload) => {
      if (connection.socket.readyState === 1) { // 1 === OPEN
        connection.socket.send(JSON.stringify(payload));
      }
    };

    fastify.eventBus.on(`note_updated:${noteId}`, eventHandler);

    connection.socket.on('message', message => {
      if (message.toString() === 'ping') {
        connection.socket.send('pong');
      }
    });

    connection.socket.on('close', () => {
      fastify.log.info({ noteId }, 'Client disconnected from Live Network');
      fastify.eventBus.off(`note_updated:${noteId}`, eventHandler);
    });
  });
}
