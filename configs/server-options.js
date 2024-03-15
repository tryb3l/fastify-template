"use strict";
const crypto = require("node:crypto");
const loggerOptions = require("./logger-options");

module.exports = {
  disableRequestLogging: true,
  logger: loggerOptions,
  requestIdLogLabel: false,
  requestIdHeader: "x-request-id",
  genReqId(req) {
    return req.headers["x-amz-request-id"] || crypto.randomUUID();
  },
  ajv: {
    customOptions: {
      removeAdditional: "all",
      prettyPrint: true,
      coerceTypes: "array",
      allErrors: true,
      nullable: true,
      unknownFormats: [
        "int32",
        "int64",
        "binary",
        "byte",
        "date",
        "date-time",
        "password",
      ],
    },
  },
};
