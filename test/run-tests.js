'use strict'

const { execSync } = require('child_process')
const path = require('node:path')
const fs = require('node:fs')
const args = process.argv.slice(2)
const isCoverage = args.includes('--coverage')
const isNoStop = args.includes('--nostop')

function getTestFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir)
  for (const file of files) {
    const filePath = path.join(dir, file)
    if (fs.statSync(filePath).isDirectory()) {
      getTestFiles(filePath, fileList)
    } else if (filePath.endsWith('.test.js')) {
      fileList.push(`"${filePath}"`)
    }
  }
  return fileList
}

async function run() {
  try {
    console.log('⏳ Running global setup (Starting Docker)...')
    execSync(`node "${path.join(__dirname, 'run-before.js')}"`, { stdio: 'inherit' })

    console.log('\n🧪 Starting Node.js Native Tests...\n')

    const testFiles = getTestFiles(__dirname)

    let testCmd = 'node'
    if (isCoverage) {
      testCmd += ' --experimental-test-coverage'
    }
    testCmd += ` --test ${testFiles.join(' ')}`

    execSync(testCmd, { stdio: 'inherit' })

  } catch (err) {
    console.error('\n❌ Tests failed!')
    process.exitCode = 1
  } finally {
    if (isNoStop) {
      console.log('\n⚠️ Skipping cleanup (--nostop). MongoDB Docker container remains running for debugging.')
    } else {
      console.log('\n🧹 Cleaning up (Stopping Docker)...')
      execSync(`node "${path.join(__dirname, 'run-after.js')}"`, { stdio: 'inherit' })
    }
  }
}

run()