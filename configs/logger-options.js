module.exports = {
  level: process.env.LOG_LEVEL || "info",
  serializers: {
    req: function (request) {
      const shouldLogBody = request.context.config.logBody === true;
      return {
        method: request.method,
        url: request.url,
        routeUrl: request.routePath,
        version: request.headers?.["accept-version"],
        user: request.user?.id,
        headers: request.headers,
        body: shouldLogBody ? request.body : undefined,
        hostname: request.hostname,
        remoteAddress: request.ip,
        remotePort: request.socket?.remotePort,
      };
    },
    res: function (reply) {
      return {
        statusCode: reply.statusCode,
        responseTime: reply.getResponseTime(),
      };
    },
  },
};
