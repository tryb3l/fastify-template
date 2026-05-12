'use strict'
const Docker = require('dockerode')
const net = require('node:net')

const { addInstantDuration, compareInstants, nowInstant } = require('../utils/time')

const docker = new Docker()

const DEFAULT_TIMEOUT_MS = 30_000

const Containers = {
  testMongo: {
    name: 'fastify-test-mongo',
    Image: 'mongo:8',
    Tty: false,
    Labels: {
      'notes.project': 'fastify-template',
      'notes.mode': 'test',
      'notes.owner': 'runtime-guard',
    },
    HostConfig: {
      PortBindings: {
        '27017/tcp': [{ HostIp: '127.0.0.1', HostPort: '27018' }],
      },
      AutoRemove: true,
    },
  },
  devMongo: {
    name: 'fastify-mongo',
    Image: 'mongo:8',
    Tty: false,
    Labels: {
      'notes.project': 'fastify-template',
      'notes.mode': 'dev',
      'notes.owner': 'runtime-guard',
    },
    HostConfig: {
      PortBindings: {
        '27017/tcp': [{ HostIp: '127.0.0.1', HostPort: '27017' }],
      },
      AutoRemove: true,
    },
  },
  devMailpit: {
    name: 'fastify-mailpit',
    Image: 'axllent/mailpit:latest',
    Tty: false,
    Labels: {
      'notes.project': 'fastify-template',
      'notes.mode': 'dev',
      'notes.owner': 'runtime-guard',
    },
    HostConfig: {
      PortBindings: {
        '1025/tcp': [{ HostIp: '127.0.0.1', HostPort: '1025' }],
        '8025/tcp': [{ HostIp: '127.0.0.1', HostPort: '8025' }],
      },
      AutoRemove: true,
    },
  },
}

function dockerConsole() {
  async function withTimeout(promiseFactory, timeoutMs = DEFAULT_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Docker operation timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      promiseFactory()
        .then((result) => {
          clearTimeout(timer)
          resolve(result)
        })
        .catch((error) => {
          clearTimeout(timer)
          reject(error)
        })
    })
  }

  async function pullImage(container, timeoutMs) {
    return new Promise((resolve, reject) => {
      withTimeout(
        () =>
          new Promise((innerResolve, innerReject) => {
            docker.pull(container.Image, (err, stream) => {
              if (err) {
                innerReject(err)
                return
              }
              docker.modem.followProgress(stream, onFinished, onProgress)
            })
            function onFinished(err, output) {
              if (err) {
                innerReject(err)
                return
              }
              innerResolve(output)
            }
            function onProgress(event) {
              console.log(event)
            }
          }),
        timeoutMs,
      )
        .then(resolve)
        .catch(reject)
    })
  }

  function waitForTcpPort({
    host = '127.0.0.1',
    port,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    intervalMs = 250,
  }) {
    const deadline = addInstantDuration(nowInstant(), { milliseconds: timeoutMs })

    return new Promise((resolve, reject) => {
      const attempt = () => {
        const socket = net.createConnection({ host, port })

        socket.once('connect', () => {
          socket.end()
          resolve()
        })

        socket.once('error', () => {
          socket.destroy()

          if (compareInstants(nowInstant(), deadline) >= 0) {
            reject(new Error(`Timed out waiting for ${host}:${port}`))
            return
          }

          setTimeout(attempt, intervalMs)
        })
      }

      attempt()
    })
  }

  return {
    async getRunningContainer(container) {
      const containers = await withTimeout(() => docker.listContainers())
      return containers.find((running) => {
        return running.Names.some((name) => name === `/${container.name}`)
      })
    },
    async startContainer(container, options = {}) {
      const { timeoutMs = DEFAULT_TIMEOUT_MS, waitForPort } = options
      const run = await this.getRunningContainer(container)
      if (!run) {
        await pullImage(container, timeoutMs)
        const containerObj = await withTimeout(() => docker.createContainer(container), timeoutMs)
        await withTimeout(() => containerObj.start(), timeoutMs)
      }

      if (waitForPort) {
        await waitForTcpPort({ port: waitForPort, timeoutMs })
      }
    },
    async stopContainer(container, timeoutMs = DEFAULT_TIMEOUT_MS) {
      const run = await this.getRunningContainer(container)
      if (run) {
        const containerObj = await docker.getContainer(run.Id)
        await withTimeout(() => containerObj.stop(), timeoutMs)
      }
    },
    pullImage,
    waitForTcpPort,
  }
}

module.exports = dockerConsole
module.exports.Containers = Containers
