'use strict'

const { styleText } = require('node:util')

// -- color enablement --------------------------------------------------------

function isColorEnabled(stream = process.stdout) {
  if (
    Object.prototype.hasOwnProperty.call(process.env, 'NO_COLOR') ||
    Object.prototype.hasOwnProperty.call(process.env, 'NODE_DISABLE_COLORS')
  ) {
    return false
  }
  if (Object.prototype.hasOwnProperty.call(process.env, 'FORCE_COLOR')) {
    return process.env.FORCE_COLOR !== '0'
  }
  return Boolean(stream?.isTTY)
}

// -- primitive ---------------------------------------------------------------

// Paint `text` with the given ANSI `format` (string or array of strings),
// respecting NO_COLOR / NODE_DISABLE_COLORS / FORCE_COLOR and the stream's
// isTTY flag.  Always returns a string.
function paint(format, text, stream = process.stdout) {
  const str = typeof text === 'string' ? text : String(text)
  if (!isColorEnabled(stream)) return str
  return styleText(format, str, { validateStream: false })
}

// -- semantic styles factory -------------------------------------------------

// Returns an object of named style helpers bound to `stream`.
// Call as  styles()  or  styles(process.stderr)  or  styles({ isTTY: true }).
function styles(stream = process.stdout) {
  return {
    accent: (v) => paint(['bold', 'cyanBright'], v, stream),
    danger: (v) => paint(['bold', 'redBright'], v, stream),
    info: (v) => paint(['bold', 'blueBright'], v, stream),
    muted: (v) => paint('dim', v, stream),
    pending: (v) => paint(['bold', 'magentaBright'], v, stream),
    strong: (v) => paint('bold', v, stream),
    success: (v) => paint(['bold', 'greenBright'], v, stream),
    warning: (v) => paint(['bold', 'yellowBright'], v, stream),
  }
}

// -- duration formatter ------------------------------------------------------

function formatDurationMs(durationMs) {
  if (!Number.isFinite(durationMs)) return 'unknown'
  if (durationMs <= 0) return '0ms'
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`

  const totalSeconds = durationMs / 1000
  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(totalSeconds < 10 ? 1 : 0)}s`
  }

  const totalMinutes = Math.floor(totalSeconds / 60)
  const seconds = Math.round(totalSeconds % 60)
  if (totalMinutes < 60) {
    return seconds === 0 ? `${totalMinutes}m` : `${totalMinutes}m ${seconds}s`
  }

  const totalHours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (totalHours < 24) {
    return minutes === 0 ? `${totalHours}h` : `${totalHours}h ${minutes}m`
  }

  const totalDays = Math.floor(totalHours / 24)
  const hours = totalHours % 24
  return hours === 0 ? `${totalDays}d` : `${totalDays}d ${hours}h`
}

module.exports = { formatDurationMs, isColorEnabled, paint, styles }
