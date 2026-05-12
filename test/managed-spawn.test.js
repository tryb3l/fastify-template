'use strict'

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { setTimeout: delay } = require('node:timers/promises')

const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fastify-template-managed-spawn-'))
process.env.FASTIFY_TEMPLATE_RUNTIME_DIR = runtimeDir

const {
  cleanupRuntime,
  getRuntimeStatus,
  modeKey,
  runtimeDir: moduleRuntimeDir,
} = require('../scripts/managed-spawn')

// -- Utils -----------------------------------------------------------------

function spawnIdleNode() {
  const child = spawn('node', ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
    detached: true,
  })
  child.unref()
  return child
}

function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function writePidFile(key, record) {
  fs.mkdirSync(runtimeDir, { recursive: true })
  fs.writeFileSync(path.join(runtimeDir, `${key}.pid.json`), `${JSON.stringify(record)}\n`, 'utf8')
}

function clearPidFile(key) {
  fs.rmSync(path.join(runtimeDir, `${key}.pid.json`), { force: true })
}

// -- modeKey -----------------------------------------------------------------

test('modeKey maps dev-prefixed strings to dev', () => {
  // Arrange / Act / Assert
  assert.strictEqual(modeKey('dev'), 'dev')
  assert.strictEqual(modeKey('dev-custom'), 'dev')
})

test('modeKey maps test-prefixed strings to test', () => {
  // Arrange / Act / Assert
  assert.strictEqual(modeKey('test'), 'test')
  assert.strictEqual(modeKey('test-coverage'), 'test')
})

test('modeKey returns default for non-string input', () => {
  // Arrange / Act / Assert
  assert.strictEqual(modeKey(null), 'default')
  assert.strictEqual(modeKey(undefined), 'default')
  assert.strictEqual(modeKey(42), 'default')
})

test('modeKey passes through unrecognised strings unchanged', () => {
  // Arrange / Act / Assert
  assert.strictEqual(modeKey('custom'), 'custom')
})

// -- getRuntimeStatus --------------------------------------------------------

test('getRuntimeStatus returns clean status for both modes when no pid files exist', (t) => {
  // Arrange
  clearPidFile('dev')
  clearPidFile('test')

  // Act
  const statuses = getRuntimeStatus()

  // Assert
  assert.strictEqual(statuses.length, 2)
  assert.deepStrictEqual(
    statuses.map((s) => s.mode),
    ['dev', 'test'],
  )
  for (const entry of statuses) {
    assert.strictEqual(entry.status, 'clean')
    assert.strictEqual(entry.pid, null)
  }
})

test('getRuntimeStatus reports stale when pid file references a dead process', (t) => {
  // Arrange
  // Use PID 1 as a proxy for "not ours to kill"; instead use an impossible PID
  // We write a pid file for an already-exited child.
  const child = spawnIdleNode()
  const pid = child.pid
  process.kill(pid, 'SIGKILL')
  writePidFile('dev', { pid, mode: 'dev', startedAt: new Date().toISOString() })

  t.after(() => clearPidFile('dev'))

  // Wait briefly then verify stale detection
  return new Promise((resolve) => {
    setTimeout(() => {
      // Act
      const statuses = getRuntimeStatus()
      const devEntry = statuses.find((s) => s.mode === 'dev')

      // Assert
      assert.strictEqual(devEntry.status, 'stale')
      assert.strictEqual(devEntry.pid, pid)
      resolve()
    }, 100)
  })
})

test('getRuntimeStatus reports active when pid file references a live process', async (t) => {
  // Arrange
  const child = spawnIdleNode()
  writePidFile('test', { pid: child.pid, mode: 'test', startedAt: new Date().toISOString() })

  t.after(async () => {
    process.kill(child.pid, 'SIGKILL')
    clearPidFile('test')
  })

  // Act
  const statuses = getRuntimeStatus()
  const testEntry = statuses.find((s) => s.mode === 'test')

  // Assert
  assert.strictEqual(testEntry.status, 'active')
  assert.strictEqual(testEntry.pid, child.pid)
})

// -- cleanupRuntime ----------------------------------------------------------

test('cleanupRuntime returns false when no pid file exists for the mode', async () => {
  // Arrange
  clearPidFile('dev')

  // Act
  const result = await cleanupRuntime('dev')

  // Assert
  assert.strictEqual(result, false)
})

test('cleanupRuntime removes a stale pid file and returns true', async (t) => {
  // Arrange
  const child = spawnIdleNode()
  const pid = child.pid
  process.kill(pid, 'SIGKILL')
  await delay(80)
  writePidFile('dev', { pid, mode: 'dev', startedAt: new Date().toISOString() })

  t.after(() => clearPidFile('dev'))

  // Act
  const result = await cleanupRuntime('dev')

  // Assert
  assert.strictEqual(result, true)
  assert.strictEqual(fs.existsSync(path.join(runtimeDir, 'dev.pid.json')), false)
})

test('cleanupRuntime kills a live process, removes pid file and returns true', async (t) => {
  // Arrange
  const child = spawnIdleNode()
  writePidFile('dev', { pid: child.pid, mode: 'dev', startedAt: new Date().toISOString() })

  t.after(() => clearPidFile('dev'))

  // Act
  const result = await cleanupRuntime('dev')

  // Assert
  assert.strictEqual(result, true)
  assert.strictEqual(isAlive(child.pid), false)
  assert.strictEqual(fs.existsSync(path.join(runtimeDir, 'dev.pid.json')), false)
})

test('runtimeDir respects FASTIFY_TEMPLATE_RUNTIME_DIR env override', () => {
  // Assert
  assert.strictEqual(moduleRuntimeDir, runtimeDir)
})
