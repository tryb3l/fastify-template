'use strict'

const path = require('node:path')
const fs = require('node:fs')

const { runManaged, repoRoot } = require('../scripts/managed-spawn')
const { styles } = require('../scripts/colors')

const args = process.argv.slice(2)
const isCoverage = args.includes('--coverage')
const isNoStop = args.includes('--nostop')
const mongoUrl = process.env.MONGO_URL || 'mongodb://127.0.0.1:27018/test'
const styledNodeTestReporterPath = path.join(__dirname, 'styled-node-test-reporter.js')
const migrateMongoBin = path.join(repoRoot, 'node_modules', '.bin', 'migrate-mongo')

function getTestFiles(dir) {
  return fs
    .globSync('**/*.test.js', { cwd: dir })
    .map((relativePath) => path.join(dir, relativePath))
    .sort()
}

if (require.main === module) {
  const st = styles(process.stdout)
  const testEnv = { ...process.env, MONGO_URL: mongoUrl }

  const nodeArgs = ['--experimental-vfs']
  if (isCoverage) {
    nodeArgs.push('--experimental-test-coverage', '--test-coverage-include-all')
  }
  nodeArgs.push(`--test-reporter=${styledNodeTestReporterPath}`)
  nodeArgs.push('--test', ...getTestFiles(__dirname))

  if (isNoStop) {
    console.log(`${st.warning('--nostop')} Docker containers will remain running after tests.`)
  }

  console.log(
    `${st.accent('Backend Test Runtime')} ${st.muted('(managed Docker + native Node runner)')}`,
  )

  runManaged({
    mode: isCoverage ? 'test-coverage' : 'test',
    steps: [
      {
        label: 'test-setup',
        command: process.execPath,
        args: [path.join(__dirname, 'run-before.js'), '--mode=test'],
        env: testEnv,
        timeoutMs: 45_000,
      },
      {
        label: 'test-migrate',
        command: process.execPath,
        args: [migrateMongoBin, 'up'],
        env: testEnv,
        timeoutMs: 60_000,
      },
      {
        label: 'test-run',
        command: process.execPath,
        args: nodeArgs,
        env: testEnv,
      },
    ],
    cleanup: isNoStop
      ? null
      : {
          label: 'test-cleanup',
          command: process.execPath,
          args: [path.join(__dirname, 'run-after.js'), '--mode=test'],
          env: testEnv,
          timeoutMs: 30_000,
        },
  }).catch((err) => {
    if (err?.message) console.error(err.message)
    process.exitCode = 1
  })
}

module.exports = { getTestFiles }
