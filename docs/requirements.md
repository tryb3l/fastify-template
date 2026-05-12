# Notes App Requirements

## 1. User Authentication and Authorization

### 1.1. Registration

- **User Story:** As a new user, I want to create an account so I can start using the app.
- **Requirements:**
  - Users should be able to register with a unique username, email address, and password.
  - Passwords should be securely hashed and salted before storage.
  - The system should prevent duplicate usernames and email addresses.
  - Successful registration should return a JSON response indicating success (e.g., `{ "registered": true }`).
  - Error scenarios (e.g., invalid input, database errors) should return appropriate error responses with informative messages.

### 1.2. Authentication

- **User Story:** As a registered user, I want to log in to my account securely.
- **Requirements:**
  - Users should be able to authenticate using their username/email and password.
  - Successful authentication should generate a JWT (JSON Web Token) and store it in an HTTP-only, secure cookie.
  - The JWT should contain the user's ID and any other relevant information for authorization.
  - Failed authentication (e.g., incorrect credentials) should return a 401 Unauthorized response.

### 1.3. Authorization (RBAC)

- **User Story:** As a user, I want to be able to access only the features and data that I'm allowed to, based on my role.
- **Requirements:**
  - Implement Role-Based Access Control (RBAC) to manage permissions.
  - Define roles (e.g., "user," "admin") and assign specific permissions to each role.
  - Store user roles in the database.
  - Use middleware or hooks to enforce RBAC checks on routes.

## 2. Notes Management

### 2.1. Create Notes

- **User Story:** As a user, I want to create new notes to store my information.
- **Requirements:**
  - Users should be able to create notes with a title and content.
  - Notes should be associated with the user who created them.
  - The system should generate a unique ID for each note.
  - Creation timestamps should be recorded.

### 2.2. Read Notes

- **User Story:** As a user, I want to view my existing notes.
- **Requirements:**
  - Users should be able to list their notes.
  - Support pagination (e.g., `skip` and `limit` query parameters).
  - Allow filtering by title (case-insensitive search).
  - Users should be able to view the details of a specific note.

### 2.3. Update Notes

- **User Story:** As a user, I want to modify my existing notes.
- **Requirements:**
  - Users should be able to update the title and content of their notes.
  - Modification timestamps should be updated.

### 2.4. Delete Notes

- **User Story:** As a user, I want to remove notes that I no longer need.
- **Requirements:**
  - Users should be able to delete their notes.

## 3. Import and Export

### 3.1. Import from CSV

- **User Story:** As a user, I want to import notes from a CSV file.
- **Requirements:**
  - The system should accept CSV files with a specific format (define the format).
  - Imported notes should be associated with the current user.
  - Handle potential errors during import (e.g., invalid file format, duplicate notes).

### 3.2. Export to CSV

- **User Story:** As a user, I want to export my notes to a CSV file.
- **Requirements:**
  - Users should be able to export their notes in a CSV format.
  - The exported file should include relevant note data (title, content, timestamps).

## 4. Frontend Integration Notes

### 4.1. Markdown Storage Contract

- **Implementation Note:** The backend keeps Markdown as the single source of truth in the `body` field.
- **Requirements:**
  - Frontend editors should send Markdown text in `body` for note create and update requests.
  - The backend stores and transmits Markdown source in `body`; it does not convert note content into rendered HTML before returning it.
  - The backend does not store HTML, AST data, or editor-specific state for notes.
  - Tags and attachments remain separate note fields rather than being embedded into the stored Markdown shape.

### 4.2. Notes List vs Detail Contract

- **Implementation Note:** The notes list endpoint is intentionally summary-only.
- **Requirements:**
  - `GET /notes` should stay summary-only metadata for browsing and pagination, not a source for full note content.
  - `GET /notes` responses include summary fields only: `id`, `title`, `tags`, `createdAt`, and `modifiedAt`.
  - `GET /notes/:id` remains the endpoint for the full Markdown source in `body` and any note attachments.

### 4.3. List Payload Reduction Snapshot

- **Validation Note:** On a validation dataset of 100 notes with large Markdown bodies around the current Milkdown target size, `GET /notes?limit=100` returned `16,827` bytes with the summary-only contract.
- **Validation Note:** The equivalent simulated pre-split full-note payload on the same persisted dataset was `3,421,727` bytes, for a reduction of `3,404,900` bytes or `99.51%`.
- **Methodology Note:** The "before" size is a simulation of the old full-note list contract built from the same stored notes, not a measurement from an old branch checkout.

### 4.4. Autosave and Live Updates

- **Implementation Note:** Note updates and live events still carry the full Markdown `body`.
- **Requirements:**
  - Frontend autosave should be debounced to avoid noisy full-body updates during active editing.
  - `PUT /notes/:id` remains the canonical update path for Markdown note bodies.
  - `NOTE_UPDATED` websocket payloads should be expected to include the full updated `body`, not a partial patch.

### 4.5. Markdown Rendering Safety

- **Implementation Note:** Markdown rendering safety is deferred to the frontend in this phase, and no frontend rendering code exists in this workspace.
- **Requirements:**
  - The Markdown `body` returned by `GET /notes/:id` is trusted storage, but it must be treated as untrusted display input by any frontend renderer.
  - The default frontend rendering policy should disable raw HTML inside Markdown.
  - If product requirements later allow raw HTML rendering, the frontend must first enforce an allowlist-based HTML sanitizer and add explicit XSS regression coverage for that path.
  - The backend does not parse Markdown into HTML or sanitize rendered HTML in this phase.
  - This backend repo defines the transport contract and rendering-safety handoff; actual renderer implementation is deferred until a frontend codebase is available.

### 4.6. HTTP Compression Scope

- **Implementation Note:** Response compression is existing backend infrastructure, not a transport fix for note writes or websocket sync.
- **Requirements:**
  - Global HTTP response compression should be treated as an optimization for large outbound responses such as `GET /notes/:id` and `GET /files/export`.
  - Compression does not reduce inbound autosave payload size for `PUT /notes/:id`; those request bodies still contain the full Markdown source.
  - Compression does not reduce websocket `NOTE_UPDATED` frame size; live update payloads still contain the full updated `body`.
  - If autosave writes or websocket traffic later become a bandwidth problem, address that in a separate slice through debounce, payload diffs, batching, or websocket-specific transport tuning rather than expanding this HTTP compression work.
