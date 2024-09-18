'use strict'

function createNotFoundError(message) {
  const error = new Error(message)
  error.name = 'NotFoundError'
  error.statusCode = 404
  return error
}

async function handleReadNoteError(error, request, reply) {
  if (error.name === 'NotFoundError') {
    const { id } = request.params
    request.log.info(`Note not found for ID: ${id} and User ID: ${request.user.id}`)
    await reply.status(404).send({
      statusCode: 404,
      error: 'Not Found',
      message: error.message,
      requestId: request.id,
    })
  } else {
    request.log.error('Error reading note:', error)
    await reply.send(error)
  }
}

module.exports = { createNotFoundError, handleReadNoteError }
