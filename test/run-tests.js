'use strict'

const path = require('node:path')
const fs = require('node:fs')

const { runManaged } = require('../scripts/managed-spawn')
const { styles } = require('../scripts/colors')

const args = process.argv.slice(2)
const isCoverage = args.includes('--coverage')
const isNoStop = args.includes('--nostop')
const mongoUrl = process.env.MONGO_URL || 'mongodb://127.0.0.1:27018/test'
const styledNodeTestReporterPath = path.join(__dirname, 'styled-node-test-reporter.js')

function getTestFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir)
  for (const file of files) {
    const filePath = path.join(dir, file)
    if (fs.statSync(filePath).isDirectory()) {
      getTestFiles(filePath, fileList)
    } else if (filePath.endsWith('.test.js')) {
      fileList.push(filePath)
    }
  }
  return fileList
}

if (require.main === module) {
  const st = styles(process.stdout)
  const testEnv = { ...process.env, MONGO_URL: mongoUrl }

  const nodeArgs = []
  if (isCoverage) nodeArgs.push('--experimental-test-coverage')
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
        command: 'node',
        args: [path.join(__dirname, 'run-before.js'), '--mode=test'],
        env: testEnv,
        timeoutMs: 45_000,
      },
      {
        label: 'test-migrate',
        command: 'npx',
        args: ['migrate-mongo', 'up'],
        env: testEnv,
        timeoutMs: 60_000,
      },
      {
        label: 'test-run',
        command: 'node',
        args: nodeArgs,
        env: testEnv,
      },
    ],
    cleanup: isNoStop
      ? null
      : {
          label: 'test-cleanup',
          command: 'node',
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
