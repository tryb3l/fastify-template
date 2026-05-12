'use strict'

try {
  process.loadEnvFile()
} catch {
  /* .env may not exist in CI/Docker */
}

const config = {
  mongodb: {
    url: process.env.MONGO_URL,

    databaseName: process.env.MONGO_URL
      ? new URL(process.env.MONGO_URL).pathname.slice(1)
      : 'test-db',

    options: {},
  },

  migrationsDir: 'migrations',

  changelogCollectionName: 'changelog',

  migrationFileExtension: '.js',

  useFileHash: false,

  moduleSystem: 'commonjs',
}

module.exports = config
