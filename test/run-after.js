'use strict'

const dockerHelper = require('./helper-docker')

const docker = dockerHelper()
const { Containers } = dockerHelper

async function after() {
  console.log('Stopping MongoDB Docker container...')
  await docker.stopContainer(Containers.mongo)
  console.log('✅ MongoDB stopped!')
}

after().catch(err => {
  console.error('❌ Failed to stop Docker container:', err)
  process.exit(1)
})