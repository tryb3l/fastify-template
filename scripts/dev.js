'use strict'

const path = require('node:path')
const { runManaged, repoRoot } = require('./managed-spawn')

const isTrace = process.argv.includes('--trace')
const fastifyBin = path.join(repoRoot, 'node_modules', '.bin', 'fastify')
const migrateMongoBin = path.join(repoRoot, 'node_modules', '.bin', 'migrate-mongo')

const appStep = isTrace
  ? {
      label: 'dev-trace-app',
      command: process.execPath,
      args: ['--trace-warnings', fastifyBin, 'start', '--options', 'app.js'],
    }
  : {
      label: 'dev-app',
      command: process.execPath,
      args: [fastifyBin, 'start', '--watch', '--pretty-logs', '--debug', '--options', 'app.js'],
    }

if (require.main === module) {
  runManaged({
    mode: 'dev',
    steps: [
      {
        label: 'dev-setup',
        command: process.execPath,
        args: [path.join(repoRoot, 'test', 'run-before.js'), '--mode=dev'],
        timeoutMs: 45_000,
      },
      {
        label: 'dev-migrate',
        command: process.execPath,
        args: [migrateMongoBin, 'up'],
        timeoutMs: 60_000,
      },
      appStep,
    ],
    cleanup: {
      label: 'dev-cleanup',
      command: process.execPath,
      args: [path.join(repoRoot, 'test', 'run-after.js'), '--mode=dev'],
      timeoutMs: 30_000,
    },
  }).catch((err) => {
    if (err?.message) console.error(err.message)
    process.exitCode = 1
  })
}
