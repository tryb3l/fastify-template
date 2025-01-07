'use strict'

const { execSync } = require('child_process')

async function run() {
  try {
    // Run the before script
    execSync('node test/run-before.js', { stdio: 'inherit' })

    // Run the tests
    execSync('node --test "test/**/*.test.js"', { stdio: 'inherit' })
  } finally {
    // Run the after script
    execSync('node test/run-after.js', { stdio: 'inherit' })
  }
}

run()
