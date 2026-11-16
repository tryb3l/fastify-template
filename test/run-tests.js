'use strict'

const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { runManaged, repoRoot } = require('../scripts/managed-spawn')
const { styles } = require('../scripts/colors')

const VALID_SCOPES = Object.freeze(['unit', 'app', 'endpoints', 'crud', 'e2e'])
const VALID_SCOPE_SET = new Set(VALID_SCOPES)
const DEFAULT_TEST_TIMEOUT_MS = 30_000
const DEFAULT_UV_THREADPOOL_SIZE = '8'
const DEFAULT_DB_CONCURRENCY_CAP = 4
const DEFAULT_MONGO_URL = 'mongodb://127.0.0.1:27018/test'

const styledNodeTestReporterPath = path.join(__dirname, 'styled-node-test-reporter.js')
const migrateMongoBin = path.join(repoRoot, 'node_modules', '.bin', 'migrate-mongo')

function parsePositiveInt(value) {
  if (value === undefined || value === null || value === '') {
    return null
  }
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null
  }
  return parsed
}

function parseCliArgs(argv) {
  let scope = null
  let coverage = false
  let noStop = false
  let ci = false
  const filters = []

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]

    if (arg === '--') {
      continue
    }

    if (arg === '--coverage') {
      coverage = true
      continue
    }

    if (arg === '--nostop') {
      noStop = true
      continue
    }

    if (arg === '--ci') {
      ci = true
      continue
    }

    if (arg === '--scope') {
      const next = argv[i + 1]
      if (!next || !VALID_SCOPE_SET.has(next)) {
        throw new Error(
          `Invalid --scope "${next || ''}". Expected one of: ${VALID_SCOPES.join(', ')}.`,
        )
      }
      scope = next
      i += 1
      continue
    }

    if (arg.startsWith('--scope=')) {
      const value = arg.slice('--scope='.length)
      if (!VALID_SCOPE_SET.has(value)) {
        throw new Error(`Invalid --scope "${value}". Expected one of: ${VALID_SCOPES.join(', ')}.`)
      }
      scope = value
      continue
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`)
    }

    filters.push(arg)
  }

  return { scope, coverage, noStop, ci, filters }
}

function getTestFiles(dir, { scope = null, filters = [] } = {}) {
  const searchRoot = scope ? path.join(dir, scope) : dir

  if (!fs.existsSync(searchRoot)) {
    return []
  }

  const normalizedFilters = filters
    .map((filter) => String(filter).trim().toLowerCase())
    .filter(Boolean)

  return fs
    .globSync('**/*.test.js', { cwd: searchRoot })
    .map((relativePath) => path.join(searchRoot, relativePath))
    .filter((filePath) => {
      if (normalizedFilters.length === 0) {
        return true
      }
      const relativeToRoot = path.relative(dir, filePath).replace(/\\/g, '/').toLowerCase()
      return normalizedFilters.some((needle) => relativeToRoot.includes(needle))
    })
    .sort()
}

function resolveTestConcurrency(
  scope,
  env = process.env,
  cpuCount = typeof os.availableParallelism === 'function'
    ? os.availableParallelism()
    : os.cpus().length,
) {
  const override = parsePositiveInt(env.TEST_CONCURRENCY)
  if (override !== null) {
    return override
  }

  if (scope === 'unit') {
    return null
  }

  const normalizedCpus = Math.max(1, Number(cpuCount) || 1)
  return Math.min(normalizedCpus, DEFAULT_DB_CONCURRENCY_CAP)
}

function resolveTestTimeoutMs(env = process.env) {
  return parsePositiveInt(env.TEST_TIMEOUT_MS) ?? DEFAULT_TEST_TIMEOUT_MS
}

function buildTestEnv(env = process.env, mongoUrl = env.MONGO_URL || DEFAULT_MONGO_URL) {
  const uvThreadpoolSize =
    typeof env.UV_THREADPOOL_SIZE === 'string' && env.UV_THREADPOOL_SIZE.trim().length > 0
      ? env.UV_THREADPOOL_SIZE
      : DEFAULT_UV_THREADPOOL_SIZE

  return {
    ...env,
    MONGO_URL: mongoUrl,
    UV_THREADPOOL_SIZE: uvThreadpoolSize,
  }
}

function buildNodeTestArgs({
  files,
  reporterPath = styledNodeTestReporterPath,
  timeoutMs = DEFAULT_TEST_TIMEOUT_MS,
  concurrency = null,
  coverage = false,
}) {
  const nodeArgs = ['--experimental-vfs']

  if (coverage) {
    nodeArgs.push('--experimental-test-coverage', '--test-coverage-include-all')
  }

  nodeArgs.push(`--test-timeout=${timeoutMs}`)

  if (concurrency !== null) {
    nodeArgs.push(`--test-concurrency=${concurrency}`)
  }

  nodeArgs.push(`--test-reporter=${reporterPath}`)
  nodeArgs.push('--test', ...files)

  return nodeArgs
}

const TERMINATION_SIGNALS = Object.freeze(['SIGINT', 'SIGTERM', 'SIGHUP'])

function forwardTerminationSignals(child, targetProcess = process) {
  const handlers = new Map()

  for (const signal of TERMINATION_SIGNALS) {
    const handler = () => {
      if (child && !child.killed) {
        try {
          child.kill(signal)
        } catch {
          // ignore if child already exited
        }
      }
    }
    handlers.set(signal, handler)
    targetProcess.on(signal, handler)
  }

  return function detachSignalForwarders() {
    for (const [signal, handler] of handlers) {
      targetProcess.off(signal, handler)
    }
    handlers.clear()
  }
}

function runDirectNodeTests(nodeArgs, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, nodeArgs, {
      cwd: repoRoot,
      env,
      stdio: 'inherit',
    })

    const detachSignals = forwardTerminationSignals(child)

    child.once('error', (err) => {
      detachSignals()
      reject(err)
    })
    child.once('close', (code, signal) => {
      detachSignals()
      if (code === 0) {
        resolve()
        return
      }
      const detail = signal ? `signal ${signal}` : `exit code ${code ?? '?'}`
      reject(new Error(`test-run failed with ${detail}`))
    })
  })
}

async function main() {
  const st = styles(process.stdout)
  const { scope, coverage, noStop, ci, filters } = parseCliArgs(process.argv.slice(2))
  const files = getTestFiles(__dirname, { scope, filters })

  if (files.length === 0) {
    const scopeText = scope ? `scope=${scope}` : 'scope=all'
    const filterText = filters.length > 0 ? ` filters=[${filters.join(', ')}]` : ''
    throw new Error(`No test files matched (${scopeText}${filterText}).`)
  }

  const testEnv = buildTestEnv(process.env)
  const timeoutMs = resolveTestTimeoutMs(process.env)
  const concurrency = resolveTestConcurrency(scope, process.env)
  const nodeArgs = buildNodeTestArgs({
    files,
    reporterPath: styledNodeTestReporterPath,
    timeoutMs,
    concurrency,
    coverage,
  })

  if (scope === 'unit' || ci) {
    const modeLabel = scope === 'unit' ? 'Zero-Docker Unit Test Runner' : 'CI Test Runner'
    console.log(`${st.accent(modeLabel)} ${st.muted(`(${files.length} file(s))`)}`)
    await runDirectNodeTests(nodeArgs, testEnv)
    return
  }

  if (noStop) {
    console.log(`${st.warning('--nostop')} Docker containers will remain running after tests.`)
  }

  const scopeSuffix = scope ? `:${scope}` : ''
  console.log(
    `${st.accent(`Backend Test Runtime${scopeSuffix}`)} ${st.muted(
      `(managed Docker + native Node runner, ${files.length} file(s))`,
    )}`,
  )

  await runManaged({
    mode: coverage ? 'test-coverage' : 'test',
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
    cleanup: noStop
      ? null
      : {
          label: 'test-cleanup',
          command: process.execPath,
          args: [path.join(__dirname, 'run-after.js'), '--mode=test'],
          env: testEnv,
          timeoutMs: 30_000,
        },
  })
}

if (require.main === module) {
  main().catch((err) => {
    if (err?.message) {
      console.error(err.message)
    }
    process.exitCode = 1
  })
}

module.exports = {
  DEFAULT_TEST_TIMEOUT_MS,
  DEFAULT_UV_THREADPOOL_SIZE,
  TERMINATION_SIGNALS,
  VALID_SCOPES,
  buildNodeTestArgs,
  buildTestEnv,
  forwardTerminationSignals,
  getTestFiles,
  parseCliArgs,
  resolveTestConcurrency,
  resolveTestTimeoutMs,
}
