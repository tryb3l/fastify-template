'use strict'

const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')
const ansiPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

const { styles: createTextStyles } = require('../scripts/colors')
const { createStyledNodeTestReporter } = require('./styled-node-test-reporter')

function stripAnsi(value) {
  return value.replace(ansiPattern, '')
}

function restoreColorEnv(t) {
  const hadNoColor = Object.prototype.hasOwnProperty.call(process.env, 'NO_COLOR')
  const originalNoColor = process.env.NO_COLOR
  const hadNodeDisableColors = Object.prototype.hasOwnProperty.call(
    process.env,
    'NODE_DISABLE_COLORS',
  )
  const originalNodeDisableColors = process.env.NODE_DISABLE_COLORS
  const hadForceColor = Object.prototype.hasOwnProperty.call(process.env, 'FORCE_COLOR')
  const originalForceColor = process.env.FORCE_COLOR

  t.after(() => {
    if (hadNoColor) {
      process.env.NO_COLOR = originalNoColor
    } else {
      delete process.env.NO_COLOR
    }

    if (hadForceColor) {
      process.env.FORCE_COLOR = originalForceColor
    } else {
      delete process.env.FORCE_COLOR
    }

    if (hadNodeDisableColors) {
      process.env.NODE_DISABLE_COLORS = originalNodeDisableColors
    } else {
      delete process.env.NODE_DISABLE_COLORS
    }
  })
}

async function collectReporterOutput(reporter, events) {
  const chunks = []

  for await (const chunk of reporter(
    (async function* source() {
      for (const event of events) {
        yield event
      }
    })(),
  )) {
    chunks.push(chunk)
  }

  return chunks.join('')
}

test('createStyledNodeTestReporter renders readable file-grouped output', async (t) => {
  // Arrange
  restoreColorEnv(t)
  delete process.env.NO_COLOR
  delete process.env.FORCE_COLOR
  const filePath = path.join(process.cwd(), 'test', 'sample.test.js')
  const failure = new Error('boom')
  failure.stack = 'Error: boom\n    at sample.test.js:10:3'
  const reporter = createStyledNodeTestReporter({
    stream: { isTTY: false },
    cwd: process.cwd(),
  })

  // Act
  const output = await collectReporterOutput(reporter, [
    {
      type: 'test:pass',
      data: {
        file: filePath,
        name: 'passes',
        nesting: 0,
        details: { duration_ms: 12 },
      },
    },
    {
      type: 'test:fail',
      data: {
        file: filePath,
        name: 'fails',
        nesting: 1,
        details: { duration_ms: 4, error: failure },
      },
    },
    {
      type: 'test:summary',
      data: {
        file: undefined,
        success: false,
        duration_ms: 16,
        counts: {
          tests: 2,
          passed: 1,
          failed: 1,
          skipped: 0,
          todo: 0,
          cancelled: 0,
        },
      },
    },
  ])

  // Assert
  const renderedOutput = stripAnsi(output)

  assert.match(renderedOutput, /test\/sample\.test\.js/)
  assert.match(renderedOutput, /✔ passes \(12ms\)/)
  assert.match(renderedOutput, /✖ fails \(4ms\)/)
  assert.match(renderedOutput, /Error: boom/)
  assert.match(renderedOutput, /Test Summary FAIL/)
  assert.ok(!output.includes(String.fromCharCode(27)))
})

test('createStyledNodeTestReporter applies ANSI styling for interactive streams', async (t) => {
  // Arrange
  restoreColorEnv(t)
  delete process.env.NO_COLOR
  delete process.env.NODE_DISABLE_COLORS
  process.env.FORCE_COLOR = '1'
  const styles = createTextStyles({ stream: { isTTY: true } })
  const reporter = createStyledNodeTestReporter({
    stream: { isTTY: true },
    cwd: process.cwd(),
  })

  // Act
  const output = await collectReporterOutput(reporter, [
    {
      type: 'test:pass',
      data: {
        file: path.join(process.cwd(), 'test', 'sample.test.js'),
        name: 'passes',
        nesting: 0,
        details: { duration_ms: 6 },
      },
    },
  ])

  // Assert
  assert.ok(output.includes(String.fromCharCode(27)))
  assert.ok(output.includes(styles.success('✔ passes')))
})

test('createStyledNodeTestReporter styles summary values for interactive streams', async (t) => {
  // Arrange
  restoreColorEnv(t)
  delete process.env.NO_COLOR
  delete process.env.NODE_DISABLE_COLORS
  process.env.FORCE_COLOR = '1'
  const styles = createTextStyles({ stream: { isTTY: true } })
  const reporter = createStyledNodeTestReporter({
    stream: { isTTY: true },
    cwd: process.cwd(),
  })

  // Act
  const output = await collectReporterOutput(reporter, [
    {
      type: 'test:summary',
      data: {
        file: undefined,
        success: false,
        duration_ms: 16,
        counts: {
          tests: 4,
          suites: 1,
          passed: 1,
          failed: 2,
          skipped: 1,
          todo: 1,
          cancelled: 0,
        },
      },
    },
  ])

  // Assert
  assert.ok(output.includes(`${styles.accent('Test Summary')} ${styles.danger('FAIL')}`))
  assert.ok(output.includes(`  ${styles.muted('passed:'.padEnd(12))} ${styles.success('1')}`))
  assert.ok(output.includes(`  ${styles.muted('failed:'.padEnd(12))} ${styles.danger('2')}`))
  assert.ok(output.includes(`  ${styles.muted('skipped:'.padEnd(12))} ${styles.warning('1')}`))
  assert.ok(output.includes(`  ${styles.muted('todo:'.padEnd(12))} ${styles.pending('1')}`))
  assert.ok(output.includes(`  ${styles.muted('duration:'.padEnd(12))} ${styles.info('16ms')}`))
})

test('createStyledNodeTestReporter suppresses stdout and stderr for passing tests by default', async (t) => {
  // Arrange
  restoreColorEnv(t)
  delete process.env.NO_COLOR
  delete process.env.FORCE_COLOR
  const filePath = path.join(process.cwd(), 'test', 'runtime-guard.test.js')
  const reporter = createStyledNodeTestReporter({
    stream: { isTTY: false },
    cwd: process.cwd(),
  })

  // Act
  const output = await collectReporterOutput(reporter, [
    {
      type: 'test:stderr',
      data: {
        file: filePath,
        message: 'Error: cleanup task failed',
      },
    },
    {
      type: 'test:pass',
      data: {
        file: filePath,
        name: 'keeps state on cleanup failure',
        nesting: 0,
        details: { duration_ms: 2 },
      },
    },
  ])

  // Assert
  const renderedOutput = stripAnsi(output)

  assert.match(renderedOutput, /✔ keeps state on cleanup failure \(2ms\)/)
  assert.doesNotMatch(renderedOutput, /cleanup task failed/)
  assert.doesNotMatch(renderedOutput, /› stderr/)
})

test('createStyledNodeTestReporter drops duplicate aggregate diagnostics when summary is available', async (t) => {
  // Arrange
  restoreColorEnv(t)
  delete process.env.NO_COLOR
  delete process.env.FORCE_COLOR
  const reporter = createStyledNodeTestReporter({
    stream: { isTTY: false },
    cwd: process.cwd(),
  })

  // Act
  const output = await collectReporterOutput(reporter, [
    {
      type: 'test:diagnostic',
      data: {
        file: undefined,
        nesting: 0,
        message: 'tests 2',
      },
    },
    {
      type: 'test:diagnostic',
      data: {
        file: undefined,
        nesting: 0,
        message: 'suites 0',
      },
    },
    {
      type: 'test:diagnostic',
      data: {
        file: undefined,
        nesting: 0,
        message: 'pass 2',
      },
    },
    {
      type: 'test:diagnostic',
      data: {
        file: undefined,
        nesting: 0,
        message: 'fail 0',
      },
    },
    {
      type: 'test:diagnostic',
      data: {
        file: undefined,
        nesting: 0,
        message: 'cancelled 0',
      },
    },
    {
      type: 'test:diagnostic',
      data: {
        file: undefined,
        nesting: 0,
        message: 'skipped 0',
      },
    },
    {
      type: 'test:diagnostic',
      data: {
        file: undefined,
        nesting: 0,
        message: 'todo 0',
      },
    },
    {
      type: 'test:diagnostic',
      data: {
        file: undefined,
        nesting: 0,
        message: 'duration_ms 15.5',
      },
    },
    {
      type: 'test:summary',
      data: {
        file: undefined,
        success: true,
        duration_ms: 15.5,
        counts: {
          tests: 2,
          suites: 0,
          passed: 2,
          failed: 0,
          skipped: 0,
          todo: 0,
          cancelled: 0,
        },
      },
    },
  ])

  // Assert
  const renderedOutput = stripAnsi(output)

  assert.match(renderedOutput, /Test Summary PASS/)
  assert.match(renderedOutput, /suites:\s+0/)
  assert.doesNotMatch(renderedOutput, /› tests 2/)
  assert.doesNotMatch(renderedOutput, /› duration_ms 15\.5/)
})

test('createStyledNodeTestReporter preserves non-summary diagnostics', async (t) => {
  // Arrange
  restoreColorEnv(t)
  delete process.env.NO_COLOR
  delete process.env.FORCE_COLOR
  const reporter = createStyledNodeTestReporter({
    stream: { isTTY: false },
    cwd: process.cwd(),
  })

  // Act
  const output = await collectReporterOutput(reporter, [
    {
      type: 'test:diagnostic',
      data: {
        file: undefined,
        nesting: 0,
        message: 'Randomized test order seed: 12345',
      },
    },
  ])

  // Assert
  const renderedOutput = stripAnsi(output)

  assert.match(renderedOutput, /› Randomized test order seed: 12345/)
})

test('createStyledNodeTestReporter renders labeled stdout and stderr blocks', async (t) => {
  // Arrange
  restoreColorEnv(t)
  delete process.env.NO_COLOR
  delete process.env.FORCE_COLOR
  const filePath = path.join(process.cwd(), 'test', 'runtime-guard.test.js')
  const reporter = createStyledNodeTestReporter({
    stream: { isTTY: false },
    cwd: process.cwd(),
    showStreams: true,
  })

  // Act
  const output = await collectReporterOutput(reporter, [
    {
      type: 'test:stdout',
      data: {
        file: filePath,
        message: 'starting managed test runtime',
      },
    },
    {
      type: 'test:stderr',
      data: {
        file: filePath,
        message: 'Error: cleanup task failed\n    at runtime-guard.test.js:348:11',
      },
    },
  ])

  // Assert
  const renderedOutput = stripAnsi(output)

  assert.match(renderedOutput, /test\/runtime-guard\.test\.js/)
  assert.match(renderedOutput, /› stdout starting managed test runtime/)
  assert.match(renderedOutput, /› stderr Error: cleanup task failed/)
  assert.match(renderedOutput, /\n\s+at runtime-guard\.test\.js:348:11/)
})

test('createStyledNodeTestReporter renders readable coverage output in plain text for non-interactive streams', async (t) => {
  // Arrange
  restoreColorEnv(t)
  delete process.env.NO_COLOR
  delete process.env.FORCE_COLOR
  const reporter = createStyledNodeTestReporter({
    stream: { isTTY: false },
    cwd: process.cwd(),
  })

  // Act
  const output = await collectReporterOutput(reporter, [
    {
      type: 'test:diagnostic',
      data: {
        file: undefined,
        nesting: 0,
        message: 'tests 2',
      },
    },
    {
      type: 'test:diagnostic',
      data: {
        file: undefined,
        nesting: 0,
        message: 'suites 0',
      },
    },
    {
      type: 'test:diagnostic',
      data: {
        file: undefined,
        nesting: 0,
        message: 'pass 2',
      },
    },
    {
      type: 'test:diagnostic',
      data: {
        file: undefined,
        nesting: 0,
        message: 'fail 0',
      },
    },
    {
      type: 'test:diagnostic',
      data: {
        file: undefined,
        nesting: 0,
        message: 'cancelled 0',
      },
    },
    {
      type: 'test:diagnostic',
      data: {
        file: undefined,
        nesting: 0,
        message: 'skipped 0',
      },
    },
    {
      type: 'test:diagnostic',
      data: {
        file: undefined,
        nesting: 0,
        message: 'todo 0',
      },
    },
    {
      type: 'test:diagnostic',
      data: {
        file: undefined,
        nesting: 0,
        message: 'duration_ms 15.5',
      },
    },
    {
      type: 'test:coverage',
      data: {
        summary: {
          totals: {
            coveredLinePercent: 87.5,
            totalLineCount: 80,
            coveredLineCount: 70,
            coveredBranchPercent: 75,
            totalBranchCount: 20,
            coveredBranchCount: 15,
            coveredFunctionPercent: 90,
            totalFunctionCount: 10,
            coveredFunctionCount: 9,
          },
        },
      },
    },
    {
      type: 'test:summary',
      data: {
        file: undefined,
        success: true,
        duration_ms: 15.5,
        counts: {
          tests: 2,
          suites: 0,
          passed: 2,
          failed: 0,
          skipped: 0,
          todo: 0,
          cancelled: 0,
        },
      },
    },
  ])

  // Assert
  const renderedOutput = stripAnsi(output)

  assert.match(renderedOutput, /Coverage/)
  assert.match(renderedOutput, /lines:\s+87\.5% \(70\/80\)/)
  assert.match(renderedOutput, /branches:\s+75\.0% \(15\/20\)/)
  assert.match(renderedOutput, /functions:\s+90\.0% \(9\/10\)/)
  assert.match(renderedOutput, /Test Summary PASS/)
  assert.doesNotMatch(renderedOutput, /› tests 2/)
  assert.doesNotMatch(renderedOutput, /› duration_ms 15\.5/)
  assert.ok(!output.includes(String.fromCharCode(27)))
})

test('createStyledNodeTestReporter styles coverage values by threshold for interactive streams', async (t) => {
  // Arrange
  restoreColorEnv(t)
  delete process.env.NO_COLOR
  delete process.env.NODE_DISABLE_COLORS
  process.env.FORCE_COLOR = '1'
  const styles = createTextStyles({ stream: { isTTY: true } })
  const reporter = createStyledNodeTestReporter({
    stream: { isTTY: true },
    cwd: process.cwd(),
  })

  // Act
  const output = await collectReporterOutput(reporter, [
    {
      type: 'test:coverage',
      data: {
        summary: {
          totals: {
            coveredLinePercent: 92,
            totalLineCount: 100,
            coveredLineCount: 92,
            coveredBranchPercent: 70,
            totalBranchCount: 20,
            coveredBranchCount: 14,
            coveredFunctionPercent: 50,
            totalFunctionCount: 10,
            coveredFunctionCount: 5,
          },
        },
      },
    },
  ])

  // Assert
  assert.ok(output.includes(styles.accent('Coverage')))
  assert.ok(output.includes(styles.success('92.0% (92/100)')))
  assert.ok(output.includes(styles.warning('70.0% (14/20)')))
  assert.ok(output.includes(styles.danger('50.0% (5/10)')))
})
