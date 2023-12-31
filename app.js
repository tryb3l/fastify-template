/**
 * This is the main application file for the Fastify boilerplate.
 * It sets up the Fastify server and loads plugins, schemas, and routes.
 *
 * @module app
 * @param {Object} fastify - The Fastify instance.
 * @param {Object} opts - The options passed to the Fastify instance.
 * @returns {Promise<void>} - A promise that resolves when the setup is complete.
 */
"use strict";

const path = require("node:path");
const AutoLoad = require("@fastify/autoload");

// Pass --options via CLI arguments in command to enable these options.
const options = {};

module.exports = async function (fastify, opts) {
  // This code block is responsible for loading all plugins located in the 'plugins' directory.
  // These plugins are considered as support plugins and are reused throughout the application.
  // The 'ignorePattern' option is a regular expression that matches files to be ignored during the autoload process. In this case, any file ending with '.no-load.js' will be ignored.
  // The commented out 'ignorePattern' option is another example of how to ignore files. This pattern ignores any file that does not contain 'load.js' in its name.
  // The 'indexPattern' option is a regular expression that matches index files to be autoloaded. In this case, any file named 'no' will be loaded.
  fastify.register(AutoLoad, {
    dir: path.join(__dirname, 'plugins'),
    dirNameRoutePrefix: false,
    ignorePattern: /.*.no-load\.js/,
    indexPattern: /^no$/I,
    options: fastify.config
  })

  // This loads all schemas defined in the schemas directory
  // Schemas are used to validate the structure of incoming requests
  // The indexPattern option is used to specify which files in the directory should be autoloaded
  // In this case, any file named loader.js will be loaded
  fastify.register(AutoLoad, {
    dir: path.join(__dirname, "schemas"),
    indexPattern: /^loader.js$/i,
  });

  // This loads all plugins defined in the 'routes' directory.
  // The 'fastify.register' function is used to load these plugins using the 'AutoLoad' plugin.
  // The 'dir' option specifies the directory of the plugins.
  // The 'indexPattern' option is a regular expression that matches files to be autoloaded. In this case, any file ending with 'routes.js' or 'routes.cjs' will be loaded.
  // The 'autoHooksPattern' option is a regular expression that matches files to be autoloaded as hooks. In this case, any file ending with 'hooks.js' or 'hooks.cjs' will be loaded as hooks.
  // The 'autoHooks' option when set to true, enables the automatic loading of hooks.
  // The 'cascadeHooks' option when set to true, enables the cascading of hooks. This means that a parent's hooks are applied before the child's hooks.
  // The 'options' option is used to pass additional options to the plugins. In this case, it's passing an object that is a copy of 'opts'.
  fastify.register(AutoLoad, {
    dir: path.join(__dirname, "routes"),
    indexPattern: /.*routes(\.js|\.cjs)$/i,
    ignorePattern: /.*\.js/,
    autoHooksPattern: /.*hooks(\.js|\.cjs)$/i,
    autoHooks: true,
    cascadeHooks: true,
    options: Object.assign({}, opts),
  });

  await fastify.register(require("./configs/config"));
  fastify.log.info("Config loaded %o", fastify.config);
};

module.exports.options = require("./configs/server-options");
