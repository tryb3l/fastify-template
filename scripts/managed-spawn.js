'use strict'

const { spawn } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')

const repoRoot = path.join(__dirname, '..')
const repoKey = crypto.createHash('sha1').update(repoRoot).digest('hex').slice(0, 12)
const runtimeDir =
  process.env.FASTIFY_TEMPLATE_RUNTIME_DIR ||
  path.join(os.tmpdir(), `fastify-template-runtime-${repoKey}`)

const GRACE_MS = 5_000

// Normalise arbitrary mode strings to 'dev' or 'test' for pid file naming.
function modeKey(mode) {
  if (typeof mode !== 'string') return 'default'
  if (mode.startsWith('dev')) return 'dev'
  if (mode.startsWith('test')) return 'test'
  return mode
}

// -- pid file utils --------------------------------------------------------

function pidFilePath(mode) {
  return path.join(runtimeDir, `${modeKey(mode)}.pid.json`)
}

function readPidFile(mode) {
  try {
    return JSON.parse(fs.readFileSync(pidFilePath(mode), 'utf8'))
  } catch {
    return null
  }
}

function writePidFile(mode, data) {
  fs.mkdirSync(runtimeDir, { recursive: true })
  const target = pidFilePath(mode)
  const tmp = `${target}.${process.pid}.tmp`
  let renamed = false
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(data)}\n`, 'utf8')
    fs.renameSync(tmp, target)
    renamed = true
  } finally {
    if (!renamed) fs.rmSync(tmp, { force: true })
  }
}

function clearPidFile(mode) {
  fs.rmSync(pidFilePath(mode), { force: true })
}

// -- process utilities -------------------------------------------------------

function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function killGroup(pid, signal) {
  if (!Number.isInteger(pid) || pid <= 0) return
  try {
    process.kill(-pid, signal)
  } catch {}
}

async function killWithGrace(pid, graceMs = GRACE_MS) {
  if (!isAlive(pid)) return
  killGroup(pid, 'SIGTERM')
  const deadline = Date.now() + graceMs
  while (isAlive(pid) && Date.now() < deadline) {
    await delay(50)
  }
  if (isAlive(pid)) killGroup(pid, 'SIGKILL')
}

// -- conflict detection ------------------------------------------------------

function checkConflict(mode) {
  const record = readPidFile(mode)
  if (!record) return
  if (isAlive(record.pid)) {
    throw new Error(
      `A managed ${modeKey(mode)} runtime is already active (owner pid ${record.pid}). ` +
        `Stop it before starting another one.`,
    )
  }
  clearPidFile(mode) // stale — silently recover
}

// -- step runner -------------------------------------------------------------

// Each step: { label, command, args?, cwd?, env?, stdio?, timeoutMs? }
// stdio defaults to 'inherit' so the child shares the parent TTY — this means
// the test reporter's process.stdout.isTTY is true and colours work natively
// without FORCE_COLOR.
function spawnStep(step, setChild) {
  const {
    label,
    command,
    args = [],
    cwd = repoRoot,
    env = process.env,
    stdio = 'inherit',
    timeoutMs = 0,
  } = step

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio, detached: true })
    setChild(child)

    let timer = null
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        killGroup(child.pid, 'SIGTERM')
        reject(new Error(`${label} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
    }

    child.once('error', (err) => {
      if (timer) clearTimeout(timer)
      reject(err)
    })
    child.once('close', (code, sig) => {
      if (timer) clearTimeout(timer)
      if (code === 0) return resolve()
      const detail = sig ? `signal ${sig}` : `exit code ${code ?? '?'}`
      reject(new Error(`${label} failed with ${detail}`))
    })
  })
}

// -- managed runner ----------------------------------------------------------

// Run `steps` sequentially inside a guarded session:
//   - Prevents two instances of the same mode from running concurrently.
//   - Tracks the active child's process group and kills it on
//     SIGINT / SIGTERM / SIGHUP / uncaughtException so no zombies are left.
//   - `cleanup` (optional) always runs after steps regardless of outcome or signal.
//   - Re-raises the original signal after cleanup so the shell sees the correct
//     exit status (e.g. 130 for SIGINT).
async function runManaged({ mode, steps, cleanup = null }) {
  checkConflict(mode)
  writePidFile(mode, {
    pid: process.pid,
    mode: modeKey(mode),
    startedAt: new Date().toISOString(),
  })

  let activeChild = null
  let receivedSignal = null

  const handleSignal = (sig) => {
    if (receivedSignal) return
    receivedSignal = sig
    if (activeChild) killGroup(activeChild.pid, 'SIGTERM')
  }

  const handleCrash = () => {
    if (receivedSignal) return
    receivedSignal = 'error'
    if (activeChild) killGroup(activeChild.pid, 'SIGTERM')
  }

  process.on('SIGINT', handleSignal)
  process.on('SIGTERM', handleSignal)
  process.on('SIGHUP', handleSignal)
  process.once('uncaughtException', handleCrash)
  process.once('unhandledRejection', handleCrash)

  let stepError = null

  try {
    for (const step of steps) {
      if (receivedSignal) break
      try {
        await spawnStep(step, (child) => {
          activeChild = child
        })
      } catch (err) {
        if (!receivedSignal) stepError = err
        break
      } finally {
        activeChild = null
      }
    }

    if (cleanup) {
      try {
        await spawnStep(cleanup, (child) => {
          activeChild = child
        })
      } catch {
        // do not mask the original stepError
      } finally {
        activeChild = null
      }
    }
  } finally {
    process.off('SIGINT', handleSignal)
    process.off('SIGTERM', handleSignal)
    process.off('SIGHUP', handleSignal)
    process.off('uncaughtException', handleCrash)
    process.off('unhandledRejection', handleCrash)
    clearPidFile(mode)
  }

  if (receivedSignal && receivedSignal !== 'error') {
    // Re-raise so the shell records the correct exit status (e.g. 130 for SIGINT).
    process.kill(process.pid, receivedSignal)
    process.exit(1) // fallback: signal delivery is nearly synchronous but not guaranteed
  }

  if (stepError) throw stepError
}

// -- status and cleanup ops (consumed by runtime-cli.js) --------------------

function getRuntimeStatus() {
  return ['dev', 'test'].map((key) => {
    const record = readPidFile(key)
    if (!record) return { mode: key, status: 'clean', pid: null, startedAt: null }
    return {
      mode: key,
      status: isAlive(record.pid) ? 'active' : 'stale',
      pid: record.pid,
      startedAt: record.startedAt ?? null,
    }
  })
}

async function cleanupRuntime(mode) {
  const key = modeKey(mode)
  const record = readPidFile(key)
  if (!record) return false
  if (isAlive(record.pid)) await killWithGrace(record.pid)
  clearPidFile(key)
  return true
}

async function cleanupAll() {
  const results = await Promise.all(['dev', 'test'].map(cleanupRuntime))
  return results.some(Boolean)
}

module.exports = {
  cleanupAll,
  cleanupRuntime,
  getRuntimeStatus,
  modeKey,
  repoRoot,
  runtimeDir,
  runManaged,
}
