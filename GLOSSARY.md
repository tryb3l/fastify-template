# Fastify Notes

A personal knowledge management and note-taking system where users write Markdown notes, organize them into structured containers, and connect them into a poly-hierarchical mind map.

## Language

**Notebook**:
A top-level, user-owned workspace binder that groups Folders and Notes around a broad subject or project. A Notebook cannot be nested inside another Notebook.
_Avoid_: Workspace, stack, vault, category

**Folder**:
A nestable container inside a single Notebook (up to 5 levels deep) used to organize Notes and child Folders hierarchically.
_Avoid_: Section, directory, subcategory, sub-notebook

**Inbox**:
The default unfiled state for a Note that has not been placed into a Notebook (`notebookId: null, folderId: null`). It is a virtual view rather than a persisted container.
_Avoid_: Default folder, root folder, uncategorized notebook

**Note**:
A user-owned Markdown document with a title, body, tags, revision counter, optional file attachments, and outgoing Note Links, filed either in the Inbox or inside a Notebook (at its root or within a Folder).
_Avoid_: Document, page, article, post

**Note Link**:
A directed, typed connection from a source Note to a target Note owned by the same user (`parent`, `child`, or `related`), authored either explicitly for the Mind Map or inline via Markdown reference syntax.
_Avoid_: Reference, pointer, hypertext link

**Backlink**:
An incoming Note Link viewed from the target Note, showing which other Notes link to it.
_Avoid_: Reverse link, inbound reference

**Mind Map**:
A poly-hierarchical graph projection (`{ nodes, edges }`) of Notes and their Note Links, allowing a Note to participate in multiple parent, child, and associative hierarchies across container boundaries.
_Avoid_: Knowledge tree, network diagram

**User Invitation**:
An admin-issued, single-use, TTL-bound registration token (`<inviteId>.<secret>`) optionally restricted to a specific email address, required to register an account when `REGISTRATION_MODE` is `invite`.
_Avoid_: Referral code, coupon, signup voucher

**Sync Tombstone**:
A TTL-bounded deletion record (`{ userId, entityType, entityId, deletedAt }`) written when a Note, Notebook, or Folder is deleted so multi-device clients polling `GET /notes/sync?since=<ISO-timestamp>` can reconcile deletions incrementally.
_Avoid_: Trash item, soft-deleted note, archive record

