'use strict'

const pino = require('pino')

module.exports = {
  level: process.env.LOG_LEVEL || 'info',
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    censor: '*****',
    paths: ['req.headers.authorization', 'req.body.password', 'req.body.email'],
  },
  serializers: {
    req: function serializeRequest(request) {
      const shouldLogBody = request.routeOptions?.config?.logBody === true
      return {
        method: request.method,
        url: request.raw.url,
        routeUrl: request.routeOptions?.url ?? request.routePath,
        version: request.headers?.['accept-version'],
        user: request.user?._id || request.user?.id,
        headers: request.headers,
        body: shouldLogBody ? request.body : undefined,
        hostname: request.hostname,
        remoteAddress: request.ip,
        remotePort: request.socket?.remotePort,
      }
    },
    res: function serializeReply(reply) {
      return {
        statusCode: reply.statusCode,
        responseTime: typeof reply.elapsedTime === 'number' ? reply.elapsedTime : undefined,
      }
    },
  },
}
