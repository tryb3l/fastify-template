'use strict'

const { EventEmitter } = require('node:events')
const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
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
} = require('../run-tests')
const { getTestEnv } = require('../test-setup')
const { normalizeSeedUserOptions } = require('../utils/setup-user')

function createTempTestTree(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fastify-run-tests-'))
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  const files = [
    'unit/crypto.test.js',
    'unit/cache.test.js',
    'app/cors.test.js',
    'endpoints/users/get-users.test.js',
    'endpoints/notes/put-note.test.js',
    'crud/notes-crud.test.js',
    'e2e/auth-lifecycle.e2e.test.js',
    'utils/setup-user.js',
  ]

  for (const rel of files) {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, "'use strict'\n")
  }

  return root
}

describe('test/run-tests.js CLI and discovery helpers', () => {
  test('parseCliArgs parses flags, --scope, and positional substring filters', () => {
    // Arrange
    const argv = ['--scope=endpoints', '--coverage', '--', 'users', 'put-note']

    // Act
    const parsed = parseCliArgs(argv)

    // Assert
    assert.deepEqual(parsed, {
      scope: 'endpoints',
      coverage: true,
      noStop: false,
      ci: false,
      filters: ['users', 'put-note'],
    })
  })

  test('parseCliArgs supports --scope <value> and --ci and --nostop', () => {
    // Arrange
    const argv = ['--scope', 'crud', '--ci', '--nostop']

    // Act
    const parsed = parseCliArgs(argv)

    // Assert
    assert.deepEqual(parsed, {
      scope: 'crud',
      coverage: false,
      noStop: true,
      ci: true,
      filters: [],
    })
  })

  test('parseCliArgs rejects unknown scopes', () => {
    // Arrange
    const argv = ['--scope=invalid']

    // Act & Assert
    assert.throws(() => parseCliArgs(argv), /Invalid --scope "invalid"/)
    assert.deepEqual([...VALID_SCOPES], ['unit', 'app', 'endpoints', 'crud', 'e2e'])
  })

  test('getTestFiles returns all .test.js files when scope and filters are omitted', (t) => {
    // Arrange
    const root = createTempTestTree(t)

    // Act
    const files = getTestFiles(root)

    // Assert
    assert.deepEqual(
      files.map((f) => path.relative(root, f).replace(/\\/g, '/')),
      [
        'app/cors.test.js',
        'crud/notes-crud.test.js',
        'e2e/auth-lifecycle.e2e.test.js',
        'endpoints/notes/put-note.test.js',
        'endpoints/users/get-users.test.js',
        'unit/cache.test.js',
        'unit/crypto.test.js',
      ],
    )
  })

  test('getTestFiles restricts discovery to --scope directory and applies substring filters', (t) => {
    // Arrange
    const root = createTempTestTree(t)

    // Act
    const scopedOnly = getTestFiles(root, { scope: 'endpoints' })
    const filtered = getTestFiles(root, { scope: 'endpoints', filters: ['PUT-NOTE'] })
    const missingScope = getTestFiles(root, { scope: 'crud', filters: ['nonexistent'] })

    // Assert
    assert.deepEqual(
      scopedOnly.map((f) => path.relative(root, f).replace(/\\/g, '/')),
      ['endpoints/notes/put-note.test.js', 'endpoints/users/get-users.test.js'],
    )
    assert.deepEqual(
      filtered.map((f) => path.relative(root, f).replace(/\\/g, '/')),
      ['endpoints/notes/put-note.test.js'],
    )
    assert.deepEqual(missingScope, [])
  })

  test('getTestFiles returns empty array if scope directory does not exist', (t) => {
    // Arrange
    const root = createTempTestTree(t)
    fs.rmSync(path.join(root, 'e2e'), { recursive: true, force: true })

    // Act
    const files = getTestFiles(root, { scope: 'e2e' })

    // Assert
    assert.deepEqual(files, [])
  })

  test('resolveTestConcurrency keeps unit unbounded and caps DB scopes at min(cpus, 4)', () => {
    // Arrange & Act & Assert
    assert.equal(resolveTestConcurrency('unit', {}, 12), null)
    assert.equal(resolveTestConcurrency('unit', { TEST_CONCURRENCY: '2' }, 12), 2)
    assert.equal(resolveTestConcurrency('endpoints', {}, 12), 4)
    assert.equal(resolveTestConcurrency(null, {}, 2), 2)
    assert.equal(resolveTestConcurrency('app', { TEST_CONCURRENCY: '6' }, 12), 6)
    assert.equal(resolveTestConcurrency('app', { TEST_CONCURRENCY: 'not-a-num' }, 12), 4)
  })

  test('resolveTestTimeoutMs defaults to 30000 and accepts valid TEST_TIMEOUT_MS overrides', () => {
    // Arrange & Act & Assert
    assert.equal(DEFAULT_TEST_TIMEOUT_MS, 30_000)
    assert.equal(resolveTestTimeoutMs({}), 30_000)
    assert.equal(resolveTestTimeoutMs({ TEST_TIMEOUT_MS: '45000' }), 45_000)
    assert.equal(resolveTestTimeoutMs({ TEST_TIMEOUT_MS: '-10' }), 30_000)
  })

  test('buildTestEnv sets UV_THREADPOOL_SIZE=8 when unset and preserves explicit override', () => {
    // Arrange & Act
    const defaulted = buildTestEnv({ PATH: '/usr/bin' }, 'mongodb://127.0.0.1:27018/test')
    const overridden = buildTestEnv(
      { PATH: '/usr/bin', UV_THREADPOOL_SIZE: '16' },
      'mongodb://127.0.0.1:27018/test',
    )

    // Assert
    assert.equal(DEFAULT_UV_THREADPOOL_SIZE, '8')
    assert.equal(defaulted.UV_THREADPOOL_SIZE, '8')
    assert.equal(defaulted.MONGO_URL, 'mongodb://127.0.0.1:27018/test')
    assert.equal(overridden.UV_THREADPOOL_SIZE, '16')
  })

  test('buildNodeTestArgs builds expected node --test arguments', () => {
    // Arrange
    const reporterPath = '/repo/test/styled-node-test-reporter.js'
    const files = ['/repo/test/unit/a.test.js']

    // Act
    const unitArgs = buildNodeTestArgs({
      files,
      reporterPath,
      timeoutMs: 30_000,
      concurrency: null,
      coverage: false,
    })
    const dbCoverageArgs = buildNodeTestArgs({
      files,
      reporterPath,
      timeoutMs: 45_000,
      concurrency: 4,
      coverage: true,
    })

    // Assert
    assert.deepEqual(unitArgs, [
      '--experimental-vfs',
      '--test-timeout=30000',
      `--test-reporter=${reporterPath}`,
      '--test',
      '/repo/test/unit/a.test.js',
    ])
    assert.deepEqual(dbCoverageArgs, [
      '--experimental-vfs',
      '--experimental-test-coverage',
      '--test-coverage-include-all',
      '--test-timeout=45000',
      '--test-concurrency=4',
      `--test-reporter=${reporterPath}`,
      '--test',
      '/repo/test/unit/a.test.js',
    ])
  })

  test('forwardTerminationSignals forwards SIGINT/SIGTERM/SIGHUP and detaches cleanly', () => {
    // Arrange
    const fakeProcess = new EventEmitter()
    const receivedSignals = []
    const fakeChild = {
      killed: false,
      kill(signal) {
        receivedSignals.push(signal)
      },
    }

    // Act
    const detach = forwardTerminationSignals(fakeChild, fakeProcess)
    for (const signal of TERMINATION_SIGNALS) {
      fakeProcess.emit(signal)
    }
    detach()
    for (const signal of TERMINATION_SIGNALS) {
      fakeProcess.emit(signal)
    }

    // Assert
    assert.deepEqual(receivedSignals, ['SIGINT', 'SIGTERM', 'SIGHUP'])
    for (const signal of TERMINATION_SIGNALS) {
      assert.equal(fakeProcess.listenerCount(signal), 0)
    }
  })

  test('normalizeSeedUserOptions supports both role string and options object signatures', () => {
    // Arrange & Act
    const fromRole = normalizeSeedUserOptions('admin', { REGISTRATION_MODE: 'invite' })
    const fromObject = normalizeSeedUserOptions({
      role: 'admin',
      emailVerified: false,
      username: 'Alice',
    })

    // Assert
    assert.equal(fromRole.role, 'admin')
    assert.equal(fromRole.emailVerified, true)
    assert.deepEqual(fromRole.env, { REGISTRATION_MODE: 'invite' })

    assert.equal(fromObject.role, 'admin')
    assert.equal(fromObject.emailVerified, false)
    assert.equal(fromObject.username, 'Alice')

    assert.throws(() => normalizeSeedUserOptions(42), TypeError)
    assert.throws(() => normalizeSeedUserOptions(['admin']), TypeError)
    assert.throws(() => normalizeSeedUserOptions('admin', ['bad-env']), TypeError)
  })

  test('getTestEnv applies 1/4 Mongo pool defaults and preserves explicit zero or undefined overrides', () => {
    // Arrange & Act
    const defaults = getTestEnv()
    const zeroMin = getTestEnv({ MONGO_MIN_POOL_SIZE: 0 })
    const cleared = getTestEnv({ MONGO_MIN_POOL_SIZE: undefined, MONGO_MAX_POOL_SIZE: undefined })

    // Assert
    assert.equal(defaults.MONGO_MIN_POOL_SIZE, '1')
    assert.equal(defaults.MONGO_MAX_POOL_SIZE, '4')
    assert.equal(zeroMin.MONGO_MIN_POOL_SIZE, 0)
    assert.equal(cleared.MONGO_MIN_POOL_SIZE, undefined)
    assert.equal(cleared.MONGO_MAX_POOL_SIZE, undefined)
  })
})
