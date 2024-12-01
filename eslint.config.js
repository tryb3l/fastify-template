const { globals } = require('globals')
const { configs } = require('@eslint/js')

module.exports = {
  env: {
    node: true,
    es2021: true,
  },
  extends: ['eslint:recommended', 'plugin:prettier/recommended'],
  parserOptions: {
    ecmaVersion: 12,
    sourceType: 'module',
  },
  rules: {
    // Add your custom rules here
  },
  globals: {
    ...globals.node,
  },
}
