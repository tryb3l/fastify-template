'use strict'

const dockerHelper = require('./test-setup-docker')

const docker = dockerHelper()
const { Containers } = dockerHelper
const args = new Set(process.argv.slice(2))
const mode = args.has('--mode=dev') ? 'dev' : 'test'

const modeConfig = {
  test: [Containers.testMongo],
  dev: [Containers.devMongo, Containers.devMailpit],
}

async function after() {
  for (const container of modeConfig[mode]) {
    console.log(`Stopping ${container.name} Docker container...`)
    await docker.stopContainer(container, 30_000)
  }
  console.log('✅ Runtime containers stopped!')
}

after().catch((err) => {
  console.error(`❌ Failed to stop Docker container: ${err?.stack || String(err)}`)
  process.exit(1)
})
