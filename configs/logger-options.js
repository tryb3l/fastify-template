module.exports = {
  level: process.env.LOG_LEVEL || "info",
  serializers: {
    res: function (reply) {
      return {
        statusCode: reply.statusCode,
        responseTime: reply.getResponseTime(),
      };
    },
  },
};
