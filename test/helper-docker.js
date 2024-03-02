"use strict";
const Docker = require("dockerode");

const Containers = {
  mongo: {
    name: "fastify-mongo",
    Image: "mongo:7",
    Tty: false,
    HostConfig: {
      PortBindings: {
        "27017/tcp": [{ HostIp: "0.0.0.0", HostPort: "27017" }],
      },
      AutoRemove: true,
    },
  },
};

function dockerConsole() {
  const docker = new Docker();
  async function pullImage(container) {
    return new Promise((resolve, reject) => {
      docker.pull(container.Image, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }
        docker.modem.followProgress(stream, onFinished, onProgress);
      });
      function onFinished(err, output) {
        if (err) {
          reject(err);
          return;
        }
        resolve(output);
      }
      function onProgress(event) {
        console.log(event);
      }
    });
  }
  return {
    async getRunningContainer(container) {
      const containers = await docker.listContainers();
      return containers.find((running) => {
        return running.Names.some((name) => name.includes(container.name));
      });
    },
    async startContainer(container) {
      const run = await this.getRunningContainer(container);
      if (!run) {
        await pullImage(container);
        const containerObj = await docker.createContainer(container);
        await containerObj.start();
      }
    },
    async stopContainer(container) {
      const run = await this.getRunningContainer(container);
      if (run) {
        const containerObj = await docker.getContainer(run.Id);
        await containerObj.stop();
      }
    },
    pullImage,
  };
}

module.exports = dockerConsole;
module.exports.Containers = Containers;
