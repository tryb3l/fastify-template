# My Fastify Template for Future Projects

## Status

[![CI](https://github.com/tryb3l/fastify-boilerplate/actions/workflows/ci.yml/badge.svg)](https://github.com/tryb3l/fastify-boilerplate/actions/workflows/ci.yml)

## Requirements

To execute this example, install Node.js and Docker. The local workflow below starts MongoDB and Mailpit for you in Docker.

#### You can use the following versions:

- Node.js 22+
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

2. **Create the local env file:**

  ```sh
  make init-env
  ```

  `make init-env` creates `.env` with local-safe defaults and generates when `ope`nssl` is available. If `.env` already exists, the target leaves it unchanged.

3. **Adjust `.env` if needed:**

    Leave `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, and `SMTP_PASS` unset to use local Mailpit by default. Review or rotate the generated secrets before reusing the environment elsewhere.

4. **Start the local stack:**

   ```sh
    make dev
   ```

    This starts MongoDB on `localhost:27017`, Mailpit SMTP on `localhost:1025`, and the Mailpit inbox UI on `http://localhost:8025`.

5. **Inspect captured email in Mailpit:**

    Open `http://localhost:8025` and trigger flows such as password reset. Development defaults to Mailpit unless you set real SMTP credentials in `.env`.

6. **Run Tests:**

   ```sh
   npm run test
   ```

7. **Stop the local containers when finished:**

    ```sh
    make dev-stop
    ```

### Switching to Real SMTP

For short manual delivery checks, add the SMTP settings below to `.env` and rerun `make dev`:

```dotenv
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password
```

Outside `development` and `test`, the app now fails fast during boot if SMTP is not configured.

### Makefile Commands

- **Create `.env` once for local development:**

  ```sh
   make init-env
  ```

- **Start local MongoDB + Mailpit + app:**

  ```sh
   make dev
  ```

- **Stop local MongoDB + Mailpit:**

  ```sh
   make dev-stop
  ```

- **Run database migrations with `.env` loaded:**

  ```sh
   make migrate
  ```

- **Run tests:**

  ```sh
   make test
  ```

- **Run lint:**

  ```sh
   make lint
  ```
