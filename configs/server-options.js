const loggerOptions = require("./logger-options");
module.exports.options = {
  disableRequestLogging: true,
  logger: loggerOptions,
  ajv: {
    customOptions: {
      coerceTypes: "array",
      removeAdditional: "all",
      useDefaults: true,
    },
  },
  logger: {
    prettyPrint: true,
    level: "debug",
    disableRequestLogging: false,
  },
};
