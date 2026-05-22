'use strict'

const path = require('node:path')

const { styles: createTextStyles, formatDurationMs } = require('../scripts/colors')

// Raw per-key diagnostic lines emitted by Node before test:summary (e.g. "tests 5", "pass 4").
// Suppress them — the same information is rendered in the formatted Test Summary block.
const SUMMARY_DIAGNOSTIC_RE = /^\w+ \d+(\.\d+)?$/

function ensureTrailingNewline(value) {
  return value.endsWith('\n') ? value : `${value}\n`
}

function isTruthyEnvValue(value) {
  if (typeof value !== 'string') {
    return false
  }

  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function isStreamOutputEnabled() {
  return isTruthyEnvValue(process.env.TEST_REPORTER_SHOW_STREAMS)
}

function formatReason(reason, styles) {
  if (!reason || reason === true) {
    return ''
  }

  return ` ${styles.muted(`— ${reason}`)}`
}

function formatFailureDetails(error, indent, styles) {
  if (!error) {
    return ''
  }

  const errorText = error.cause?.stack || error.stack || String(error)

  return errorText
    .trimEnd()
    .split('\n')
    .map((line) => `${indent}${styles.muted(line)}`)
    .join('\n')
}

function formatOutcomeSymbol(eventType, data) {
  if (data.skip) {
    return '○'
  }

  if (data.todo) {
    return '…'
  }

  if (eventType === 'test:pass') {
    return '✔'
  }

  return '✖'
}

function getOutcomeTextStyler(eventType, data, styles) {
  if (data.skip) {
    return styles.warning
  }

  if (data.todo) {
    return styles.pending
  }

  if (eventType === 'test:pass') {
    return styles.success
  }

  return styles.danger
}

function getSummaryCountValue(data, key) {
  return data?.counts?.[key] ?? 0
}

function formatSummaryValue(key, value, styles) {
  const text = String(value)

  switch (key) {
    case 'passed':
      return value > 0 ? styles.success(text) : styles.strong(text)
    case 'failed':
    case 'cancelled':
      return value > 0 ? styles.danger(text) : styles.strong(text)
    case 'skipped':
      return value > 0 ? styles.warning(text) : styles.strong(text)
    case 'todo':
      return value > 0 ? styles.pending(text) : styles.strong(text)
    case 'duration':
      return styles.info(text)
    default:
      return styles.strong(text)
  }
}

function formatCoverageValue(percent, coveredCount, totalCount, styles) {
  const formatted = `${percent.toFixed(1)}% (${coveredCount}/${totalCount})`

  if (percent >= 80) {
    return styles.success(formatted)
  }

  if (percent >= 60) {
    return styles.warning(formatted)
  }

  return styles.danger(formatted)
}

function maybeRenderFileHeading(filePath, seenFiles, styles, cwd) {
  if (!filePath || seenFiles.has(filePath)) {
    return ''
  }

  seenFiles.add(filePath)

  const relativeFilePath = path.relative(cwd, filePath) || path.basename(filePath)

  return `\n${styles.accent(relativeFilePath)}\n`
}

function renderLabeledMessageBlock({
  label,
  labelStyle,
  message,
  filePath,
  seenFiles,
  styles,
  cwd,
}) {
  if (!message) {
    return ''
  }

  const fileHeading = maybeRenderFileHeading(filePath, seenFiles, styles, cwd)
  const lines = String(message).trimEnd().split('\n')
  const prefix = `${styles.muted('  ›')} ${labelStyle(label)} `
  const continuationPrefix = `${' '.repeat(4 + label.length + 1)}`

  return `${fileHeading}${lines
    .map((line, index) => `${index === 0 ? prefix : continuationPrefix}${line}`)
    .join('\n')}\n`
}

function renderTestOutcome(eventType, data, seenFiles, styles, cwd) {
  const fileHeading = maybeRenderFileHeading(data.file, seenFiles, styles, cwd)
  const symbol = formatOutcomeSymbol(eventType, data)
  const styleOutcomeText = getOutcomeTextStyler(eventType, data, styles)
  const indent = '  '.repeat(Math.max(0, data.nesting || 0))
  const detailIndent = `${indent}    `
  const durationText =
    Number.isFinite(data.details?.duration_ms) && !data.skip && !data.todo
      ? ` ${styles.muted(`(${formatDurationMs(data.details.duration_ms)})`)}`
      : ''
  const annotation = formatReason(data.skip || data.todo, styles)
  const name = data.details?.type === 'suite' ? styles.strong(data.name) : data.name
  const headline = `${indent}${styleOutcomeText(`${symbol} ${name}`)}${durationText}${annotation}`

  if (eventType !== 'test:fail') {
    return `${fileHeading}${headline}\n`
  }

  const failureDetails = formatFailureDetails(data.details?.error, detailIndent, styles)

  if (!failureDetails) {
    return `${fileHeading}${headline}\n`
  }

  return `${fileHeading}${headline}\n${failureDetails}\n`
}

function renderSummary(data, styles) {
  if (data.file) {
    return ''
  }

  const outcome = data.success ? styles.success('PASS') : styles.danger('FAIL')
  const tests = getSummaryCountValue(data, 'tests')
  const suites = getSummaryCountValue(data, 'suites')
  const passed = getSummaryCountValue(data, 'passed')
  const failed = getSummaryCountValue(data, 'failed')
  const skipped = getSummaryCountValue(data, 'skipped')
  const todo = getSummaryCountValue(data, 'todo')
  const cancelled = getSummaryCountValue(data, 'cancelled')
  const duration = formatDurationMs(data.duration_ms)

  return [
    '',
    `${styles.accent('Test Summary')} ${outcome}`,
    `  ${styles.muted('tests:'.padEnd(12))} ${formatSummaryValue('tests', tests, styles)}`,
    `  ${styles.muted('suites:'.padEnd(12))} ${formatSummaryValue('suites', suites, styles)}`,
    `  ${styles.muted('passed:'.padEnd(12))} ${formatSummaryValue('passed', passed, styles)}`,
    `  ${styles.muted('failed:'.padEnd(12))} ${formatSummaryValue('failed', failed, styles)}`,
    `  ${styles.muted('skipped:'.padEnd(12))} ${formatSummaryValue('skipped', skipped, styles)}`,
    `  ${styles.muted('todo:'.padEnd(12))} ${formatSummaryValue('todo', todo, styles)}`,
    `  ${styles.muted('cancelled:'.padEnd(12))} ${formatSummaryValue('cancelled', cancelled, styles)}`,
    `  ${styles.muted('duration:'.padEnd(12))} ${formatSummaryValue('duration', duration, styles)}`,
    '',
  ].join('\n')
}

function renderCoverageSummary(data, styles) {
  const totals = data.summary?.totals

  if (!totals) {
    return ''
  }

  return [
    `${styles.accent('Coverage')}`,
    `  ${styles.muted('lines:'.padEnd(12))} ${formatCoverageValue(totals.coveredLinePercent, totals.coveredLineCount, totals.totalLineCount, styles)}`,
    `  ${styles.muted('branches:'.padEnd(12))} ${formatCoverageValue(totals.coveredBranchPercent, totals.coveredBranchCount, totals.totalBranchCount, styles)}`,
    `  ${styles.muted('functions:'.padEnd(12))} ${formatCoverageValue(totals.coveredFunctionPercent, totals.coveredFunctionCount, totals.totalFunctionCount, styles)}`,
    '',
  ].join('\n')
}

function createStyledNodeTestReporter({
  stream = process.stdout,
  cwd = process.cwd(),
  showStreams = isStreamOutputEnabled(),
} = {}) {
  const styles = createTextStyles({ stream })
  const seenFiles = new Set()

  return async function* styledNodeTestReporter(source) {
    for await (const event of source) {
      switch (event.type) {
        case 'test:pass':
          yield renderTestOutcome(event.type, event.data, seenFiles, styles, cwd)
          break
        case 'test:fail':
          yield renderTestOutcome(event.type, event.data, seenFiles, styles, cwd)
          break
        case 'test:summary': {
          const summary = renderSummary(event.data, styles)

          if (summary) {
            yield ensureTrailingNewline(summary)
          }
          break
        }
        case 'test:coverage': {
          const coverage = renderCoverageSummary(event.data, styles)

          if (coverage) {
            yield ensureTrailingNewline(coverage)
          }
          break
        }
        case 'test:diagnostic':
          // Suppress raw count lines that duplicate the formatted Test Summary block.
          if (!event.data.file && SUMMARY_DIAGNOSTIC_RE.test(event.data.message)) {
            break
          }

          yield `${styles.muted('  ›')} ${event.data.message}\n`
          break
        case 'test:stdout':
          if (showStreams) {
            yield renderLabeledMessageBlock({
              label: 'stdout',
              labelStyle: styles.info,
              message: event.data.message,
              filePath: event.data.file,
              seenFiles,
              styles,
              cwd,
            })
          }
          break
        case 'test:stderr':
          if (showStreams) {
            yield renderLabeledMessageBlock({
              label: 'stderr',
              labelStyle: styles.danger,
              message: event.data.message,
              filePath: event.data.file,
              seenFiles,
              styles,
              cwd,
            })
          }
          break
        default:
          break
      }
    }
  }
}

const styledNodeTestReporter = createStyledNodeTestReporter()

module.exports = Object.assign(styledNodeTestReporter, {
  createStyledNodeTestReporter,
})
