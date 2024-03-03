module.exports.options = {
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
