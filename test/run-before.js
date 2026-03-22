'use strict'

const dockerHelper = require('./helper-docker')

const docker = dockerHelper()
const { Containers } = dockerHelper

async function before() {
  console.log('Starting MongoDB Docker container...')
  await docker.startContainer(Containers.mongo)

  await new Promise(resolve => setTimeout(resolve, 5000))
  console.log('✅ MongoDB is ready!')
}

before().catch(err => {
  console.error('❌ Failed to start Docker container:', err)
  process.exit(1)
})