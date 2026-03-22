'use strict'

const { execSync } = require('child_process')
const path = require('node:path')
const fs = require('node:fs')

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

    execSync(`node --test ${testFiles.join(' ')}`, { stdio: 'inherit' })

  } catch (err) {
    console.error('\n❌ Tests failed!')
    process.exitCode = 1
  } finally {
    console.log('\n🧹 Cleaning up (Stopping Docker)...')
    execSync(`node "${path.join(__dirname, 'run-after.js')}"`, { stdio: 'inherit' })
  }
}

run()