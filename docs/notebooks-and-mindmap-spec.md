# Notebooks, Nested Folders, Poly-Hierarchical Mind-Map Links & Deep Store Architecture Specification

## Overview

This specification records the user stories, acceptance criteria, invariants, and architectural postmortem decisions for the five architecture deepening tasks completed on `2026-10-29`:

1. **Task #1 — Request-Scoped Monomorphic Store Seam & Internal Cache/Side-Effect Locality** (`plugins/notes-store.js`, `routes/notes/autohooks.js`, `routes/notebooks/autohooks.js`)
2. **Task #2 — Poly-Hierarchical Note Links, Backlinks & Mind-Map Graph** (`plugins/notes-store.js`, `routes/notes/routes.js`, `migrations/005-notebooks-folders-and-links.js`)
3. **Task #3 — Two-Tier Notebook → Folder Hierarchy & Dead Seam Pruning** (`plugins/notebooks-store.js`, `routes/notebooks/routes.js`, `GLOSSARY.md`)
4. **Task #4 — Deep Attachment File Manager & Lifecycle Seam** (`plugins/notes-file-manager.js`, `routes/notes/files/routes.js`, `schemas/dotenv.json`, `plugins/config.js`)
5. **Task #5 — Unified Note Contract, Schema Loader & Streaming CSV Codec** (`routes/notes/note-contract.js`, `routes/notes/query-shapes.js`, `routes/notes/schemas/loader.js`, `schemas/loader.js`, `utils/notes-csv.js`)

---

## Core User Stories & Acceptance Criteria

### US-1: Top-Level Notebooks & Virtual Inbox
- **User Story:** As a user, I want to organize my notes into top-level **Notebooks** while keeping quick, unfiled notes in a default **Inbox** so I can separate broad projects without being forced to categorize every note immediately.
- **Acceptance Criteria:**
  - `POST /notebooks` creates a user-owned Notebook (`id` as UUIDv7, `name` 1–100 chars, optional `description` up to 500 chars, `createdAt`, `modifiedAt`).
  - `GET /notebooks`, `GET /notebooks/:id`, and `PUT /notebooks/:id` are strictly scoped by `{ id, userId }` in MongoDB filters; cross-tenant access returns `404`.
  - A Note with `{ notebookId: null, folderId: null }` resides in the virtual **Inbox** (no synthetic Inbox row is stored in MongoDB).
  - A Note can reside directly at a Notebook's root (`{ notebookId: <uuid>, folderId: null }`).
  - `GET /notes?inbox=true` filters for Inbox notes (`notebookId: null, folderId: null`); `GET /notes?notebookId=<uuid>` and `GET /notes?folderId=<uuid>` filter by container.
  - `DELETE /notebooks/:id` rejects non-empty Notebooks (containing any Folders or Notes) with `409 Conflict` (`code: 'NOTEBOOK_NOT_EMPTY'`).

### US-2: Nested Folders Inside a Notebook
- **User Story:** As a user, I want to create nested **Folders** inside a Notebook (up to 5 levels deep) and view the folder tree with note counts so I can structure subtopics cleanly.
- **Acceptance Criteria:**
  - `POST /notebooks/:id/folders` creates a Folder inside an owned Notebook with optional `parentId` (`uuid | null`).
  - Folder nesting depth is capped at `MAX_FOLDER_DEPTH = 5`; exceeding depth `5` on creation or reparenting (`PUT /notebooks/folders/:folderId`) returns `400 Bad Request`.
  - `PUT /notebooks/folders/:folderId` enforces `Set`-based cycle detection (rejecting self-parenting or moving a Folder under its own descendant with `400 Bad Request`) and forbids moving a Folder across different Notebooks (`400 Bad Request`).
  - Assigning a Note to a `folderId` requires a non-null `notebookId` that owns that Folder; violating this invariant on `POST /notes`, `PUT /notes/:id`, or `POST /files/import` returns `400 Bad Request` (or `404` if unowned).
  - `DELETE /notebooks/folders/:folderId` rejects non-empty Folders (containing child Folders or Notes) with `409 Conflict` (`code: 'FOLDER_NOT_EMPTY'`).
  - `GET /notebooks/tree` and `GET /notebooks/:id/tree` return the nested Folder hierarchy and accurate note counts (`inboxNoteCount`, `rootNoteCount`, `totalNoteCount`, per-folder `noteCount`) using parallel queries + in-process `Map` tree assembly (no recursive $N+1$ DB queries).

### US-3: Poly-Hierarchical Note Links, Backlinks & Mind-Map Subgraphs
- **User Story:** As a user, I want to connect Notes with typed links (`parent`, `child`, `related`) both explicitly and inline via Markdown syntax so I can explore backlinks and render poly-hierarchical Mind Maps on the frontend.
- **Acceptance Criteria:**
  - Each Note stores outgoing directed links in `links: [{ targetId, relation, label? }]`, where `relation` is `'parent' | 'child' | 'related'`.
  - On `POST /notes` and `PUT /notes/:id`, inline Markdown wiki-links (`[[<uuid>]]`, `[[<uuid>|Label]]`) and note URIs (`[Label](note://<uuid>)`) are automatically extracted as `relation: 'related'` and merged with explicit `links` using Node 26 `Set.prototype.difference()`.
  - If the same `targetId` appears in both explicit `links` and Markdown body text, the explicit link's `relation` and `label` take precedence. Self-links (`targetId === note.id`) are ignored.
  - All linked `targetId`s are batch-verified against `{ userId, id: { $in: [...] } }`; any missing or cross-tenant `targetId` fails fast with `404 Not Found`.
  - `GET /notes/:id/backlinks` returns incoming links from other Notes owned by the same user (`sourceId`, `title`, `notebookId`, `folderId`, `relation`, `label`, `modifiedAt`).
  - `GET /notes/graph` returns `{ data: { nodes, edges } }` where `nodes` omit the heavy Markdown `body`. When `rootNoteId` is provided, MongoDB `$graphLookup` traverses outgoing hops up to `maxDepth` (1–5, default 3) with `restrictSearchWithMatch: { userId }` and includes direct incoming backlinks. When `notebookId` or `folderId` is provided, the graph is scoped to that container.
  - When a Note is deleted via `DELETE /notes/:id`, incoming links pointing to that Note across the user's other Notes are atomically removed via `$pull` and their cached reads are invalidated.

### US-4: Revision-Guarded Note Moves & Request-Scoped Store Locality
- **User Story:** As a user editing and filing notes across tabs, I want note moves and link updates to respect optimistic concurrency (`expectedRevision`) and immediately invalidate stale caches.
- **Acceptance Criteria:**
  - `routes/notes/autohooks.js` and `routes/notebooks/autohooks.js` bind V8-monomorphic `request.notesDataSource` (`ScopedNotesDataSource`) and `request.notebooksDataSource` (`ScopedNotebooksDataSource`) instances with `this.userId` sealed at `onRequest`.
  - Moving a Note between Notebooks/Folders (`PUT /notes/:id` with `notebookId`/`folderId`) is guarded by `expectedRevision`, increments `revision`, emits `NOTE_UPDATED` on `eventBus`, writes an audit log, and invalidates the per-note cache entry inside `notesDataSource`.
  - Moving a Note to `{ notebookId: null }` automatically clears `folderId` to `null`.
  - The URL-heuristic `plugins/cache-invalidation.js` hook, `routes/data-store.js`, `utils/error.js`, and `plugins/metrics.js` are removed.

### US-5: Deep Attachment Lifecycle & Container-Scoped CSV Import/Export
- **User Story:** As a user, I want uploaded note attachments to be cleaned up from disk when a note is deleted, and I want to import/export CSV note lists into or from a specific Notebook or Folder.
- **Acceptance Criteria:**
  - `plugins/notes-file-manager.js` (`fastify.notesFileManager`) encapsulates `UPLOAD_DIR` configuration, safe path resolution, multipart upload staging + magic-byte verification (`stageUploads`), RFC 9110 `ETag` (`Temporal.Instant.epochNanoseconds`) / `If-None-Match` / `If-Modified-Since` conditional download resolution (`resolveAttachmentDownload`), and disk file deletion (`deleteNoteAttachments`).
  - Deleting a Note with attachments unlinks its attachment files from `UPLOAD_DIR`.
  - `POST /files/import` accepts optional `?notebookId=<uuid>&folderId=<uuid>`, verifies container ownership before streaming, and batches inserts into that container.
  - `GET /files/export` accepts optional `?notebookId=<uuid>&folderId=<uuid>&inbox=true&title=...` and streams formula-sanitized CSV rows using `createNotesCsvExportStream()`.
  - `routes/notes/note-contract.js` serves as the single source of truth for `NOTE_CONSTRAINTS`, MongoDB projections, CSV headers/columns, and Fastify `$id`/`$ref` schemas registered via `schemas/loader.js`.

### US-6: Local HTTPS Certificates for OpenAPI (`/docs`) & Test Suite Execution
- **User Story:** As a developer, I want local TLS certificates generated automatically in `.certs/` so I can access OpenAPI (`/docs`) over `https://localhost:3000/docs` and execute the test suite (`make test`) against the HTTPS-enabled Fastify server.
- **Acceptance Criteria:**
  - `make init-certs` generates `.certs/localhost.pem` and `.certs/localhost-key.pem` (using `mkcert` when installed or `openssl` as fallback), and `.certs/` is ignored in `.gitignore`.
  - `configs/server-options.js` automatically enables `https: { key, cert }` when `.certs/localhost-key.pem` and `.certs/localhost.pem` exist (unless `HTTPS_ENABLED=false`).
  - Network-bound test helpers (`test/utils/http-compression.js`, `test/routes/integration/notes/live.test.js`, `test/routes/integration/infrastructure/ready.test.js`) detect `app.initialConfig?.https` and execute HTTP compression, `wss://` WebSocket, and `/docs/json` OpenAPI requests over TLS.

---

## Postmortem & Architectural Decisions Summary

| Area | Friction Found | Decision & Mechanism | Reference |
| --- | --- | --- | --- |
| **Container Model** | Overloading "Notebook" and "Folder" or allowing arbitrary multi-folder containment causes ambiguous counts and tree cycles. | Two-tier container hierarchy (`Notebook` → nested `Folder` up to depth 5 → `Note`) + virtual `Inbox` (`notebookId: null, folderId: null`). | `GLOSSARY.md`, `ADR-0001` |
| **Poly-Hierarchy** | Folder trees cannot represent multi-parent mind maps without duplicating notes. | Directed, typed `links[]` (`parent`, `child`, `related`) on `Note` + Markdown `[[uuid]]` / `note://uuid` extraction + `$graphLookup`. | `ADR-0001`, `plugins/notes-store.js` |
| **Store Seam** | Routes manually passed `request.user._id`, constructed cache keys, emitted events, and relied on URL regexes in `cache-invalidation.js`. | Prototype-backed `ScopedNotesDataSource` & `ScopedNotebooksDataSource` bound on `request` in `autohooks.js`; store owns cache, audit, and events. | `ADR-0002`, Packt Fastify Ch. 8 |
| **Attachment Seam** | `routes/notes/files/routes.js` hardcoded `./uploads` and `deleteNote()` orphaned files on disk. | Extracted `plugins/notes-file-manager.js` (`fastify.notesFileManager`) with `UPLOAD_DIR` config, compensating cleanup, and `deleteNoteAttachments()`. | `fastify/demo` file-manager pattern |
| **Schema & CSV Drift** | Field limits, Mongo projections, JSON schemas, and CSV columns were duplicated across 10+ files. | Consolidated into `routes/notes/note-contract.js` and streaming helpers in `utils/notes-csv.js`, loaded via `schemas/loader.js`. | Packt Fastify Ch. 8 schema loader |
