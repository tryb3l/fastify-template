# Fastify Notes Backend

[![CI](https://github.com/tryb3l/fastify-boilerplate/actions/workflows/ci.yml/badge.svg)](https://github.com/tryb3l/fastify-boilerplate/actions/workflows/ci.yml)

Backend API for a Markdown note-taking application, built with Fastify and MongoDB. This repository started as a personal Fastify project template and grew into the backend service for managing notes, attachments, CSV imports/exports, and user accounts.

## Features

- **Markdown Notes CRUD & Readiness** (`routes/notes/`): Create, read, update, and delete notes with Markdown stored directly in `body`, `readiness` (`to_review`, `in_progress`, `mastered`), and `noteType` (`standard`, `post_mortem`). `GET /notes` returns summary metadata (`id`, `title`, `tags`, `notebookId`, `folderId`, `readiness`, `noteType`, `revision`, `createdAt`, `modifiedAt`) for fast pagination and container/Inbox filtering; `GET /notes/:id` returns the full note with attachments and links, cached in memory; `GET /notes/sync` serves incremental delta-sync across notes, notebooks, folders, flashcards, and tombstones.
- **Notebooks, Campaigns & Nested Folders** (`routes/notebooks/`, `plugins/notebooks-store.js`): Organize notes into evergreen **Notebooks** (`mode: 'notebook'`) or time-bound preparation **Campaigns** (`mode: 'campaign'`, `status: 'active' | 'archived'`, `targetDate`, and `interview`/`exam` starter folder templates) with nested **Folders** (up to 5 levels deep, cycle detection, and `409 Conflict` guards on non-empty deletes), or leave unfiled notes in the virtual **Inbox** (`notebookId: null, folderId: null`). `GET /notebooks/tree` and `GET /notebooks/:id/tree` assemble folder hierarchies, note counts, and weighted Readiness rollups (including 1-hop linked canonical notes while excluding `post_mortem` debriefs).
- **Universal Flashcards & Dual-Mode Leitner Drills** (`routes/flashcards/`, `plugins/flashcards-store.js`): Create Q&A flashcards linked to any note and run active-recall drills via `GET /flashcards/drill` in either `scheduled` mode (`nextReviewAt <= now`) or `cram_all` mode (ignoring due dates for last-minute interview or exam cramming, with `weakest_first`, `sequential`, or `shuffled` ordering and 1-hop external link expansion). Reviewing cards via `POST /flashcards/:id/review` (`again`, `hard`, `good`) updates the 5-box Leitner schedule and bidirectionally promotes or demotes the parent note's `readiness`.
- **Dashboard Telemetry** (`routes/dashboard/`, `plugins/daily-activity-store.js`): Pre-aggregates daily study actions in `dailyActivity` (`{ userId, date: 'YYYY-MM-DD' }`) and exposes `GET /dashboard/summary` with Inbox count, due flashcards count, active Campaigns/Notebooks with readiness and due cards, a 12-week (84-day) contribution heatmap, and 14-day velocity metrics.
- **Poly-Hierarchical Note Links & Mind-Map Graph** (`plugins/notes-store.js`): Connect notes across containers using explicit typed links (`parent`, `child`, `related`) and automatic Markdown link extraction (`[[<uuid>|Label]]` and `[Label](note://<uuid>)`). Query incoming backlinks at `GET /notes/:id/backlinks` and multi-hop mind-map subgraphs (with 1-hop external link expansion annotated via `isExternal` and `homeNotebookId`) at `GET /notes/graph`.
- **Optimistic Concurrency & Idempotent Autosave**: Every note tracks an integer `revision` (starting at `1`). `PUT /notes/:id` (body) and `DELETE /notes/:id` (query) require `expectedRevision` and return `409 Conflict` (`NOTE_STALE_SAVE` or `NOTE_STALE_DELETE`) with `currentRevision` and `currentModifiedAt` on mismatch, while no-op autosaves skip revision bumps and redundant broadcasts.
- **Attachments, Range Streaming & CSV Sync** (`routes/notes/files/`): Upload and stream note attachments (verified by extension and magic bytes including audio/video, with HTTP `Range` `206 Partial Content` byte-slice streaming, per-user storage quotas, `ETag` and `If-Modified-Since` caching, and automatic disk cleanup on note/user delete) and stream notes to/from CSV (`/files/import`, `/files/export`) with optional `notebookId`/`folderId` scoping and spreadsheet formula sanitization.
- **Authentication, Invite-Gated Signup, Email Verification & RBAC** (`routes/auth/`, `routes/users/`): Argon2id password hashing, short-lived JWT access tokens paired with HTTP-only refresh token cookies (`/auth/refresh`), CSRF token protection, configurable `REGISTRATION_MODE` (`invite` | `open` | `closed`) with emailed admin invites (`/users/invites`), email verification (`/auth/verify-email/request`, `/auth/verify-email/confirm`), password reset, `user`/`admin` role enforcement, PII-scrubbing cascade account deletion, and audit logging.
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

The production compose file exposes the backend on `http://localhost:3042` (`3042:3000`). When running behind a reverse proxy or load balancer (such as Nginx, Caddy, or Cloudflare), set `TRUST_PROXY` in `.env` (for example `TRUST_PROXY=127.0.0.1,172.16.0.0/12` or a hop count like `TRUST_PROXY=1`) so rate limiting and audit logs resolve real client IPs from `X-Forwarded-For`; when unset or `false`, `X-Forwarded-For` is ignored. MongoDB connection pool bounds default to `MONGO_MAX_POOL_SIZE=20` and `MONGO_MIN_POOL_SIZE=2` and can be tuned via `.env` for managed Cloud MongoDB tiers. Stop the stack with:

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
| `make lint`                | Run Oxlint                                                                     |
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
