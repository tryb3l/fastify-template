'use strict'

const { parseArgs } = require('node:util')

const {
  cleanupAll,
  getManagedContainerStatus,
  getRuntimeStatus,
  runtimeDir,
} = require('./managed-spawn')
const { styles } = require('./colors')

function parseRuntimeCliArgs(argv) {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      json: {
        type: 'boolean',
        default: false,
      },
    },
  })

  return {
    action: positionals[0],
    json: values.json,
    hasUnexpectedPositionals: positionals.length > 1,
  }
}

async function runRuntimeOpsCli({
  argv = process.argv.slice(2),
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  let parsedArgs

  try {
    parsedArgs = parseRuntimeCliArgs(argv)
  } catch (error) {
    stderr.write(`${error?.message || String(error)}\n`)
    stderr.write('Usage: node scripts/runtime-cli.js <status|cleanup> [--json]\n')
    return 1
  }

  if (parsedArgs.hasUnexpectedPositionals) {
    stderr.write('Usage: node scripts/runtime-cli.js <status|cleanup> [--json]\n')
    return 1
  }

  const { action, json } = parsedArgs
  const st = styles(stdout)

  if (action === 'status') {
    const statuses = getRuntimeStatus()
    let containerStatuses = null
    let dockerError = null
    try {
      containerStatuses = await getManagedContainerStatus()
    } catch (error) {
      dockerError = error?.message || String(error)
    }

    if (json) {
      stdout.write(
        `${JSON.stringify({ runtimeDir, statuses, containers: containerStatuses, dockerError }, null, 2)}\n`,
      )
      return 0
    }

    stdout.write(`${st.accent('Runtime Status')} ${st.muted(runtimeDir)}\n`)
    for (const entry of statuses) {
      const statusLabel =
        entry.status === 'active'
          ? st.success('active')
          : entry.status === 'stale'
            ? st.warning('stale')
            : st.muted('clean')
      const detail = entry.status !== 'clean' ? ` ${st.muted(`pid=${entry.pid}`)}` : ''
      stdout.write(`  ${st.strong(entry.mode.padEnd(6))} ${statusLabel}${detail}\n`)
    }

    stdout.write(`${st.accent('Docker Containers')}\n`)
    if (dockerError) {
      stdout.write(`  ${st.warning('unavailable')} ${st.muted(dockerError)}\n`)
      return 0
    }
    const activeModes = new Set(statuses.filter((s) => s.status === 'active').map((s) => s.mode))
    for (const entry of containerStatuses) {
      const statusLabel =
        entry.status !== 'running'
          ? st.muted('stopped')
          : activeModes.has(entry.mode)
            ? st.success('running')
            : st.warning('leaked')
      stdout.write(`  ${st.strong(entry.name.padEnd(20))} ${statusLabel}\n`)
    }
    return 0
  }

  if (action === 'cleanup') {
    let anyClean
    try {
      anyClean = await cleanupAll()
    } catch (error) {
      const message = error?.message || String(error)
      if (json) {
        stdout.write(`${JSON.stringify({ ok: false, error: message })}\n`)
      } else {
        stderr.write(`Runtime cleanup could not reach Docker: ${message}\n`)
      }
      return 1
    }

    if (json) {
      stdout.write(`${JSON.stringify({ ok: true, anyClean })}\n`)
      return 0
    }

    stdout.write('Cleaned backend-owned stale processes, runtime state, and managed containers.\n')
    return 0
  }

  stderr.write('Usage: node scripts/runtime-cli.js <status|cleanup> [--json]\n')
  return 1
}

if (require.main === module) {
  runRuntimeOpsCli().then((exitCode) => {
    if (exitCode !== 0) {
      process.exitCode = exitCode
    }
  })
}

module.exports = {
  parseRuntimeCliArgs,
  runRuntimeOpsCli,
}
