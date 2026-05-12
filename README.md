# My Fastify Template for Future Projects

## Status

[![CI](https://github.com/tryb3l/fastify-boilerplate/actions/workflows/ci.yml/badge.svg)](https://github.com/tryb3l/fastify-boilerplate/actions/workflows/ci.yml)

## Requirements

To execute this example, install Node.js and Docker. The local workflow below starts MongoDB and Mailpit for you in Docker.

#### You can use the following versions:

- Node.js 26+
- Latest Docker engine

The backend now uses the built-in Temporal API available in Node.js 26. Keep Temporal usage inside business-logic helpers and convert back to native `Date` values at MongoDB or other library boundaries.

## Getting Started

### Running the Project Using Docker

1. **Build the Docker Image:**

   ```sh
   docker build -t fastify-boilerplate .
   ```

2. **Start the Docker Containers:**
   ```sh
   docker compose -f docker-compose.yml up
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

`make init-env` creates `.env` with local-safe defaults and generates secrets when `openssl` is available. If `.env` already exists, the target leaves it unchanged.

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
   make test
   ```

`make test` starts the managed local test runtime, including Docker-backed test dependencies, managed runtime state, and cleanup.

Use the raw CI-oriented runner only when the test dependencies are already available outside the managed wrapper:

```sh
make test-ci
```

`make test-ci` and `npm run test:ci` are intentionally plain, CI-style entrypoints. They do not boot MongoDB or other test dependencies for you.

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

- **Show the canonical local command surface:**

  ```sh
   make
  ```

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

- **Inspect managed runtime state:**

  ```sh
   make runtime-status
  ```

- **Clean managed runtime state and owned processes:**

  ```sh
   make runtime-cleanup
  ```

- **Run database migrations with `.env` loaded:**

  ```sh
   make migrate
  ```

- **Run tests:**

  ```sh
   make test
  ```

- **Run the raw CI-style Node suite when test dependencies are already running:**

  ```sh
   make test-ci
  ```

- **Run lint:**

  ```sh
   make lint
  ```

- **Emit machine-readable managed runtime status:**

  ```sh
   make runtime-status-json
  ```

### Runtime Status And Cleanup

- `make runtime-status` and `npm run runtime:status` show human-readable managed runtime status and keep exit code `0` for inspection.
- `make runtime-status-json` and `npm run runtime:status -- --json` emit machine-readable JSON without ANSI styling.
- `make runtime-cleanup` and `npm run runtime:cleanup` clean backend-owned runtime state and owned stale processes.
- Cleanup first attempts a graceful stop, waits for the process to exit, and then escalates to forced termination if the process remains alive.
- If cleanup still cannot remove all runtime state, the cleanup command exits with code `1` and prints a manual-recovery message instead of pretending the machine is clean.

### Stale Runtime State

- Managed runtimes record ownership in the system temp directory instead of inside the repository.
- Automatic stale-state recovery only happens after the recorded runtime has been inactive for the stale-state TTL, which defaults to 15 minutes.
- If a recorded runtime is too recent for automatic recovery, startup fails fast and asks you to wait for the TTL window or run explicit cleanup.
- Explicit cleanup bypasses the stale-state TTL so operators can recover immediately.

### Output And Color Behavior

- Human-oriented Node-managed surfaces such as `make dev`, `make test`, `make runtime-status`, and the managed local Node test reporter use semantic color when the output stream is interactive.
- Set `NO_COLOR` to disable ANSI styling. Set `FORCE_COLOR=1` to force ANSI styling on Node-managed human output even for non-TTY streams.
- JSON status output remains plain text JSON.
- `make help` is plain text by design so the make entrypoint stays thin and predictable.
- Focused wrapper tests intentionally use quiet output sinks so they can validate lifecycle semantics without leaking fake operator banners into the suite output.
