'use strict'

const dockerHelper = require('./test-setup-docker')

const docker = dockerHelper()
const { Containers } = dockerHelper
const args = new Set(process.argv.slice(2))
const mode = args.has('--mode=dev') ? 'dev' : 'test'

const modeConfig = {
  test: {
    containers: [{ definition: Containers.testMongo, waitForPort: 27018 }],
    label: 'test',
  },
  dev: {
    containers: [
      { definition: Containers.devMongo, waitForPort: 27017 },
      { definition: Containers.devMailpit },
    ],
    label: 'dev',
  },
}

async function before() {
  const currentMode = modeConfig[mode]

  for (const container of currentMode.containers) {
    console.log(
      `Starting ${container.definition.name} Docker container for ${currentMode.label} mode...`,
    )
    await docker.startContainer(container.definition, {
      waitForPort: container.waitForPort,
      timeoutMs: 45_000,
    })
  }

  console.log(`✅ ${currentMode.label} runtime containers are ready!`)
}

before().catch((err) => {
  console.error(`❌ Failed to start Docker container: ${err?.stack || String(err)}`)
  process.exit(1)
})
