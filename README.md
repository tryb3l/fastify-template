# My Fastify Template for Future Projects

## Status

[![CI](https://github.com/tryb3l/fastify-boilerplate/actions/workflows/ci.yml/badge.svg)](https://github.com/tryb3l/fastify-boilerplate/actions/workflows/ci.yml)

## Requirements

To execute this example, you'll need to install Node.js, Docker, and MongoDB. MongoDB can be installed locally or used in a Docker environment.

#### You can use the following versions:

- Node.js 21+
- MongoDB 7
- Latest Docker engine

## Getting Started

### Running the Project Using Docker

1. **Build the Docker Image:**

   ```sh
   docker build -t fastify-boilerplate .
   ```

2. **Start the Docker Containers:**
   ```sh
   docker-compose -f docker/docker-compose-test.yml up
   ```

### Running the Project Locally

1. **Install Dependencies:**

   ```sh
   npm install
   ```

2. **Start MongoDB:**

   ```sh
   npm run mongo:start
   ```

3. **Start the Server:**

   ```sh
   npm run start
   ```

4. **Run Tests:**
   ```sh
   npm run test
   ```

### Makefile Commands

- **Build the Project:**

  ```sh
  make build
  ```

- **Run the Database:**

  ```sh
  make run_database
  ```

- **Run the Server:**

  ```sh
  make run_server
  ```

- **Run Tests:**

  ```sh
  make run_test
  ```

- **Stop the Database:**

  ```sh
  make stop_database
  ```

- **Run All (Build, Run Database, Run Server):**
  ```sh
  make all
  ```

## Project Structure
