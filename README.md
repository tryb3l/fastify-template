# Fastify Notes Backend

[![CI](https://github.com/tryb3l/fastify-boilerplate/actions/workflows/ci.yml/badge.svg)](https://github.com/tryb3l/fastify-boilerplate/actions/workflows/ci.yml)

Backend API for a Markdown note-taking application, built with Fastify and MongoDB. This repository started as a personal Fastify project template and grew into the backend service for managing notes, attachments, CSV imports/exports, and user accounts.

## Features

- **Markdown Notes CRUD** (`routes/notes/`): Create, read, update, and delete notes with Markdown stored directly in `body`. `GET /notes` returns summary metadata (`id`, `title`, `tags`, `notebookId`, `folderId`, `revision`, `createdAt`, `modifiedAt`) for fast pagination and container/Inbox filtering; `GET /notes/:id` returns the full note with attachments and links, cached in memory.
- **Notebooks & Nested Folders** (`routes/notebooks/`, `plugins/notebooks-store.js`): Organize notes into top-level **Notebooks** and nested **Folders** (up to 5 levels deep, with cycle detection and `409 Conflict` guards on non-empty deletes), or leave unfiled notes in the virtual **Inbox** (`notebookId: null, folderId: null`). `GET /notebooks/tree` and `GET /notebooks/:id/tree` assemble folder hierarchies and note counts in two parallel queries.
- **Poly-Hierarchical Note Links & Mind-Map Graph** (`plugins/notes-store.js`): Connect notes across containers using explicit typed links (`parent`, `child`, `related`) and automatic Markdown link extraction (`[[<uuid>|Label]]` and `[Label](note://<uuid>)`). Query incoming backlinks at `GET /notes/:id/backlinks` and multi-hop mind-map subgraphs via MongoDB `$graphLookup` at `GET /notes/graph`.
- **Optimistic Concurrency**: Every note tracks an integer `revision` (starting at `1`). `PUT /notes/:id` (body) and `DELETE /notes/:id` (query) require `expectedRevision` and return `409 Conflict` (`NOTE_STALE_SAVE` or `NOTE_STALE_DELETE`) with `currentRevision` and `currentModifiedAt` on mismatch.
- **Attachments & CSV Sync** (`routes/notes/files/`): Upload and download note attachments (up to 10 MB, verified by extension and magic bytes, with `ETag` and `If-Modified-Since` caching and automatic disk cleanup on note delete) and stream notes to/from CSV (`/files/import`, `/files/export`) with optional `notebookId`/`folderId` scoping and spreadsheet formula sanitization.
- **Authentication, RBAC & Password Reset** (`routes/auth/`, `routes/users/`): Argon2id password hashing, short-lived JWT access tokens paired with HTTP-only refresh token cookies (`/auth/refresh`), CSRF token protection, email-based password reset, `user`/`admin` role enforcement, and audit logging.
- **Operational Endpoints**: OpenAPI docs at `/docs` (non-production), health check with MongoDB ping at `/health`, and readiness check at `/ready`.

## Requirements

- **Node.js 26+** (uses the built-in `Temporal` API and `node --run`)
- **Docker** (powers local MongoDB 7 and Mailpit containers)

> Keep `Temporal` usage inside business-logic helpers and convert back to native `Date` values at MongoDB or other library boundaries.

## Quick Start (Local Development)

1. **Install dependencies:**

   ```sh
   npm install
   ```

2. **Generate `.env` with local defaults:**

   ```sh
   make init-env
   ```

   Creates `.env` once with `MONGO_URL`, `FRONTEND_URL`, `LOG_LEVEL`, `MAIL_FROM`, and `openssl`-generated `JWT_SECRET` and `COOKIE_SECRET`. If `.env` already exists, it is left unchanged.

3. **Start the local development stack (generates local HTTPS certs in `.certs/` automatically):**

   ```sh
   make dev
   ```

   Generates `.certs/localhost.pem` and `.certs/localhost-key.pem` via `make init-certs` (using `mkcert` when installed, or `openssl` as fallback), starts Docker containers for MongoDB (`localhost:27017`) and Mailpit (`localhost:1025` SMTP, `http://localhost:8025` web UI), runs pending database migrations, and boots Fastify in watch mode over HTTPS on `https://localhost:3000` (Swagger UI at `https://localhost:3000/docs`). Stopping `make dev` (`Ctrl+C`) automatically stops the managed dev containers.

4. **Run tests and linting:**

   ```sh
   make verify
   ```

## Docker Compose Workflows

### Local Docker Stack (with Mailpit)

Runs MongoDB, Mailpit, and the backend container in development mode without requiring external SMTP credentials:

```sh
make dev-compose
```

Inspect captured emails (such as password reset links) at `http://localhost:8025`.

### Production Docker Stack

Requires real SMTP settings (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`) in `.env`. Outside `development` and `test`, the server fails fast at startup if SMTP is not configured.

```sh
make up
```

The production compose file exposes the backend on `http://localhost:3042` (`3042:3000`). Stop the stack with:

```sh
make down
```

### Testing Real SMTP Locally

To test real email delivery during local development, uncomment and populate the SMTP variables in `.env`, then restart `make dev`:

```dotenv
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password
```

## Makefile Reference

Run `make` (or `make help`) to list documented targets:

| Command                    | Description                                                                    |
| -------------------------- | ------------------------------------------------------------------------------ |
| `make init-env`            | Create `.env` with local development defaults if missing                       |
| `make init-certs`          | Generate local TLS certificates in `.certs/` (`mkcert` or `openssl`)           |
| `make check-env`           | Validate required secrets (`JWT_SECRET`, `COOKIE_SECRET`) in `.env`            |
| `make start-docker`        | Check that Docker is installed and start the daemon if stopped                 |
| `make dev`                 | Start managed MongoDB + Mailpit, run migrations, and run Fastify in watch mode |
| `make dev-app`             | Start both this backend and `../note-explorer` in dev mode                     |
| `make dev-trace`           | Start the managed local runtime with `--trace-warnings`                        |
| `make dev-compose`         | Start the full local Docker Compose stack with Mailpit                         |
| `make migrate`             | Apply `migrate-mongo` database migrations with `.env` loaded                   |
| `make test`                | Run the managed test suite (starts an isolated test MongoDB on port `27018`)   |
| `make test-cov`            | Run the managed test suite with coverage                                       |
| `make test-ci`             | Run `node --run test:ci` directly without starting Docker containers           |
| `make lint`                | Run ESLint                                                                     |
| `make verify`              | Run `lint` followed by `test`                                                  |
| `make runtime-status`      | Show human-readable status for managed local runtimes                          |
| `make runtime-status-json` | Emit plain-text JSON status for managed local runtimes                         |
| `make runtime-cleanup`     | Stop owned stale processes and clean managed runtime state                     |
| `make up` / `make down`    | Start or stop the production Docker Compose stack                              |

## Managed Runtime & Concurrency Notes

### Managed Runtime State

- `make dev` and `make test` track owned processes and containers in the OS temp directory so interrupted runs can be inspected (`make runtime-status`) or cleaned up (`make runtime-cleanup`).
- Automatic stale-state recovery runs only after a 15-minute inactivity TTL. If a previous session is newer than 15 minutes, startup exits early and prompts you to wait or run `make runtime-cleanup` (which bypasses the TTL, attempts a graceful stop, and escalates to forced termination if needed).
- Interactive terminal output uses semantic ANSI color by default. Set `NO_COLOR=1` to disable color or `FORCE_COLOR=1` to force it on non-TTY streams. `make help` and `make runtime-status-json` always emit unstyled plain text.

### Notes Concurrency & Live Feed Details

- `modifiedAt` is audit/display metadata only; write conflicts are checked strictly against the integer `revision` in a single atomic MongoDB operation.
- Uploading or removing attachments updates `modifiedAt` and increments `revision` so attachment changes propagate through workspace delta-sync (`GET /notes/sync`).
- The WebSocket endpoint at `/notes/live/:id` requires an `Authorization` header during the upgrade handshake (which browser `WebSocket` clients cannot set directly). The `note-explorer` frontend coordinates same-browser-tab updates via `BroadcastChannel` and REST refetches instead.
