'use strict'

const { parseArgs } = require('node:util')

const { cleanupAll, getRuntimeStatus, runtimeDir } = require('./managed-spawn')
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

    if (json) {
      stdout.write(`${JSON.stringify({ runtimeDir, statuses }, null, 2)}\n`)
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
    return 0
  }

  if (action === 'cleanup') {
    const anyClean = await cleanupAll()

    if (json) {
      stdout.write(`${JSON.stringify({ ok: true, anyClean })}\n`)
      return 0
    }

    stdout.write('Cleaned backend-owned stale processes and runtime state.\n')
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
