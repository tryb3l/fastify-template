# Fastify Notes

A personal knowledge management and note-taking system where users write Markdown notes, organize them into structured containers, and connect them into a poly-hierarchical mind map.

## Language

**Notebook**:
A top-level, user-owned workspace binder (`mode: 'notebook'`) that groups Folders and Notes around a broad evergreen subject or project. A Notebook cannot be nested inside another Notebook.
_Avoid_: Workspace, stack, vault, category

**Campaign**:
A time-bound, target-driven top-level container (`mode: 'campaign'`) stored in the `notebooks` collection with `status: 'active' | 'archived'`, an optional `targetDate`, and optional starter Folders (`interview` or `exam`), used for focused interview or exam preparation and archivable after completion.
_Avoid_: Project, course, sprint, workspace

**Folder**:
A nestable container inside a single Notebook or Campaign (up to 5 levels deep) used to organize Notes and child Folders hierarchically.
_Avoid_: Section, directory, subcategory, sub-notebook

**Inbox**:
The default unfiled state for a Note that has not been placed into a Notebook (`notebookId: null, folderId: null`). It is a virtual view rather than a persisted container.
_Avoid_: Default folder, root folder, uncategorized notebook

**Note**:
A user-owned Markdown document with a title, body, tags, readiness state (`'to_review' | 'in_progress' | 'mastered'`), note type (`'standard' | 'post_mortem'`), revision counter, optional file attachments, and outgoing Note Links, filed either in the Inbox or inside a Notebook/Campaign (at its root or within a Folder).
_Avoid_: Document, page, article, post

**Readiness**:
The mastery state of a standard Note (`'to_review' | 'in_progress' | 'mastered'`) and its weighted container rollup (`scorePercent` and 0–10 `blocks`) across internal Notes, descendant Folders, and 1-hop external linked Notes.
_Avoid_: Progress bar, completion rate, grade

**Post-Mortem Note**:
A Note with `noteType: 'post_mortem'` used to record interview stage debriefs or exam retrospectives inside a Campaign or Folder without being counted in the container's Readiness denominator.
_Avoid_: Debrief doc, retro item, log entry

**Flashcard**:
A user-owned active-recall Q&A prompt (`front`, `back`) attached to a parent Note (`noteId`) and scheduled across 5 Leitner boxes (`box: 1..5`, `nextReviewAt`, `reviewCount`, `lapseCount`, `lastRating`).
_Avoid_: Quiz item, deck card, prompt

**Leitner Drill**:
An active-recall study session (`GET /flashcards/drill` and `POST /flashcards/:id/review`) operating either in `scheduled` mode (due cards only) or `cram_all` mode (all cards in scope regardless of due date), bidirectionally coupled with the parent Note's Readiness.
_Avoid_: Study quiz, test run, practice exam

**Daily Activity**:
A pre-aggregated per-user UTC daily telemetry record (`{ userId, date: 'YYYY-MM-DD' }`) tracking daily Note, Post-Mortem, and Flashcard actions to power the 12-week contribution heatmap and 14-day velocity charts on `GET /dashboard/summary`.
_Avoid_: Audit log rollup, analytics event, user metric

**Note Link**:
A directed, typed connection from a source Note to a target Note owned by the same user (`parent`, `child`, or `related`), authored either explicitly for the Mind Map or inline via Markdown reference syntax. Container-scoped Mind Maps, Readiness rollups, and Flashcard drills expand 1-hop outgoing Note Links (`includeExternal: true`) to pull in canonical Notes from other Notebooks without duplication.
_Avoid_: Reference, pointer, hypertext link

**Backlink**:
An incoming Note Link viewed from the target Note, showing which other Notes link to it.
_Avoid_: Reverse link, inbound reference

**Mind Map**:
A poly-hierarchical graph projection (`{ nodes, edges }`) of Notes and their Note Links, allowing a Note to participate in multiple parent, child, and associative hierarchies across container boundaries (with external 1-hop nodes annotated via `isExternal` and `homeNotebookId`).
_Avoid_: Knowledge tree, network diagram

**User Invitation**:
An admin-issued, single-use, TTL-bound registration token (`<inviteId>.<secret>`) optionally restricted to a specific email address (and emailed via `sendInviteMail`), required to register an account when `REGISTRATION_MODE` is `invite` and automatically marking the redeemed account `emailVerified: true`.
_Avoid_: Referral code, coupon, signup voucher

**Sync Tombstone**:
A TTL-bounded deletion record (`{ userId, entityType, entityId, deletedAt }`) written when a Note, Notebook, Folder, or Flashcard is deleted so multi-device clients polling `GET /notes/sync?since=<ISO-timestamp>` can reconcile deletions incrementally.
_Avoid_: Trash item, soft-deleted note, archive record

