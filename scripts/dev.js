'use strict'

const path = require('node:path')
const { runManaged, repoRoot } = require('./managed-spawn')

const isTrace = process.argv.includes('--trace')

const appStep = isTrace
  ? {
      label: 'dev-trace-app',
      command: 'node',
      args: [
        '--trace-warnings',
        path.join(repoRoot, 'node_modules', '.bin', 'fastify'),
        'start',
        '--options',
        'app.js',
      ],
    }
  : {
      label: 'dev-app',
      command: 'npx',
      args: ['fastify', 'start', '--watch', '--pretty-logs', '--debug', '--options', 'app.js'],
    }

if (require.main === module) {
  runManaged({
    mode: 'dev',
    steps: [
      {
        label: 'dev-setup',
        command: 'node',
        args: [path.join(repoRoot, 'test', 'run-before.js'), '--mode=dev'],
        timeoutMs: 45_000,
      },
      {
        label: 'dev-migrate',
        command: 'npx',
        args: ['migrate-mongo', 'up'],
        timeoutMs: 60_000,
      },
      appStep,
    ],
    cleanup: {
      label: 'dev-cleanup',
      command: 'node',
      args: [path.join(repoRoot, 'test', 'run-after.js'), '--mode=dev'],
      timeoutMs: 30_000,
    },
  }).catch((err) => {
    if (err?.message) console.error(err.message)
    process.exitCode = 1
  })
}
