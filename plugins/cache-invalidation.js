'use strict'

const fp = require('fastify-plugin')

module.exports = fp(async function cacheInvalidationPlugin(fastify) {
    fastify.log.info('Starting registration of cache-invalidation plugin')

    fastify.addHook('onResponse', async (request, reply) => {
        if (reply.statusCode >= 400) {
            return
        }

        if (request.method !== 'PUT' && request.method !== 'DELETE' && request.method !== 'POST') {
            return
        }

        const pathname = (request.url || '').split('?')[0]
        if (!pathname.startsWith('/notes/')) {
            return
        }

        const noteId = request.params?.id || request.query?.noteId
        const userId = request.user?._id || request.user?.id

        if (!noteId || !userId) {
            return
        }

        try {
            await fastify.cacheDelete(`note:${noteId}:${userId}`)
        } catch (err) {
            request.log.warn({ err, noteId, userId }, 'Failed to invalidate note cache key')
        }
    })

    fastify.log.info('Successfully registered cache-invalidation plugin')
}, {
    name: 'cache-invalidation',
    dependencies: ['app-cache']
})
