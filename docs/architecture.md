# SyncNotes — Architecture

This document explains how SyncNotes works and, more importantly, **why** it is built this way.
Every guarantee described here is backed by an automated test; the
[test map](#11-what-the-tests-prove) at the end links each claim to the suite that verifies it.

- [1. Goals and non-goals](#1-goals-and-non-goals)
- [2. System overview](#2-system-overview)
- [3. Data model](#3-data-model)
- [4. Authentication and sessions](#4-authentication-and-sessions)
- [5. The collaboration protocol](#5-the-collaboration-protocol)
- [6. Authorisation on a live WebSocket](#6-authorisation-on-a-live-websocket)
- [7. Persistence](#7-persistence)
- [8. Offline editing and reconnection](#8-offline-editing-and-reconnection)
- [9. Horizontal scaling and Redis failure](#9-horizontal-scaling-and-redis-failure)
- [10. Version history](#10-version-history)
- [11. What the tests prove](#11-what-the-tests-prove)
- [12. Trade-offs and future work](#12-trade-offs-and-future-work)

---

## 1. Goals and non-goals

**Goals**

1. Several people edit the same note at the same time and **no keystroke is ever lost**.
2. Permissions are enforced by the **server**, including on WebSocket sessions that are
   already open when access changes.
3. Users can keep working **offline**; changes merge when the connection returns.
4. The collaboration tier scales **horizontally** and degrades gracefully when Redis fails.
5. Data survives restarts and deploys.

**Non-goals (for now)**: comments, real-time cursors outside the editor body, end-to-end
encryption, multi-region deployment. See [§12](#12-trade-offs-and-future-work).

## 2. System overview

```mermaid
flowchart LR
  subgraph Browser
    UI[React + Tiptap]
    YD[(Y.Doc)]
    IDB[(IndexedDB<br/>y-indexeddb)]
    UI <--> YD <--> IDB
  end

  subgraph Edge[nginx :8080]
    N[static SPA + reverse proxy]
  end

  subgraph Services
    API[NestJS API<br/>REST]
    C1[Collab #1<br/>Hocuspocus]
    C2[Collab #2<br/>Hocuspocus]
  end

  PG[(PostgreSQL)]
  R[(Redis)]

  UI -- "HTTPS /api<br/>HttpOnly cookies + CSRF" --> N --> API
  YD -- "WSS /collab<br/>Yjs sync protocol" --> N --> C1 & C2
  API --> PG
  C1 & C2 --> PG
  API -- "access events (pub)" --> R
  C1 & C2 <-- "doc + awareness fan-out,<br/>access events (sub)" --> R
```

| Component | Responsibility | Does **not** |
| --- | --- | --- |
| **web** (`apps/web`) | UI, Tiptap editor, Yjs replica, offline cache, connection state | trust itself for permissions |
| **api** (`apps/api`) | accounts, sessions, notes/folders, sharing & roles, version listing, issuing collaboration tickets | touch live documents |
| **collab** (`apps/collab`) | Yjs sync over WebSocket, presence, per-message authorisation, persistence, snapshots/restores | manage accounts or memberships |
| **PostgreSQL** | source of truth: users, sessions, memberships, binary Yjs state, versions | — |
| **Redis** | low-latency fan-out between collab instances; API → collab access events | hold anything that cannot be lost |

Two backend processes with a narrow contract (`packages/shared`) keep responsibilities clear:
the API never edits documents, the collaboration server never decides *who* may do *what* —
it only enforces what Postgres says.

Socket.IO is not used: Yjs already defines an efficient sync protocol (state vectors + binary
diffs) and Hocuspocus implements it, so a second real-time channel would add a protocol
without solving a new problem. Commands that are not document edits (save/restore a version,
role-changed notifications) travel as Hocuspocus *stateless* messages on the same connection.

## 3. Data model

```mermaid
erDiagram
  users ||--o{ sessions : "refresh-token family"
  users ||--o{ folders : owns
  users ||--o{ note_members : "is member"
  notes ||--o{ note_members : "shared with"
  folders |o--o{ note_members : "files (per user)"
  notes ||--o{ note_versions : snapshots

  notes {
    uuid id
    bytea ydoc_state "Y.encodeStateAsUpdate"
    text title "derived"
    text excerpt "derived"
    text plain_text "derived, for search"
    timestamptz content_updated_at
  }
  note_members {
    uuid note_id
    uuid user_id
    enum role "OWNER | EDITOR | VIEWER"
    uuid folder_id "nullable, personal"
  }
  sessions {
    uuid family_id
    text token_hash "sha-256"
    timestamptz rotated_at
    timestamptz revoked_at
  }
```

Design decisions:

- **The CRDT is the content.** `notes.ydoc_state` is the binary output of
  `Y.encodeStateAsUpdate`. `title`, `excerpt` and `plain_text` are *projections* written by the
  collaboration server on every store so the REST API can list and search notes without
  decoding CRDTs.
- **Exactly one owner** per note is enforced by the database, not only by code:
  `CREATE UNIQUE INDEX … ON note_members(note_id) WHERE role = 'OWNER'`.
- **Folders are personal.** The folder reference lives on the membership row, so a shared
  note can be in *"Work"* for the owner and *"From Ada"* for a collaborator.
- **Non-members get 404, not 403**, so note ids cannot be probed for existence.

## 4. Authentication and sessions

| Cookie | Content | Flags | Sent to |
| --- | --- | --- | --- |
| `sn_access` | JWT (HS256, 15 min) with `sub`, `sid` (session family) | `HttpOnly; SameSite=Lax` (+`Secure` in prod) | `/` |
| `sn_refresh` | 256-bit random token (stored as SHA-256 hash) | `HttpOnly; SameSite=Strict` | `/api/auth` only |
| `sn_csrf` | random token, readable by JS | `SameSite=Lax` | `/` |

- **Passwords**: Argon2id (19 MiB, t=2). Unknown e-mails run a dummy verification so response
  time does not reveal whether an account exists; both cases return the same message.
- **Brute force**: per-IP rate limit on credential endpoints + per-account lockout
  (5 failures → 15 minutes).
- **CSRF**: double-submit cookie on every state-changing request, plus SameSite cookies and a
  strict CORS allow-list.
- **Refresh rotation with reuse detection** — every refresh token is single-use:

```mermaid
sequenceDiagram
  participant B as Browser
  participant A as API
  participant DB as Postgres
  B->>A: POST /auth/refresh (sn_refresh = T1)
  A->>DB: UPDATE sessions SET rotated_at=now() WHERE hash(T1) AND rotated_at IS NULL
  A->>DB: INSERT session (same family_id, hash(T2))
  A-->>B: Set-Cookie sn_access, sn_refresh = T2
  Note over B,A: Later an attacker replays the stolen T1
  B->>A: POST /auth/refresh (T1)
  A->>DB: T1 already rotated → revoke whole family
  A-->>B: 401 — and every access token of that family is now rejected
```

The access-token guard checks that the token's session family is still active, so logout and
reuse detection take effect **immediately** rather than when the 15-minute JWT expires. A
10-second grace window treats a rotated token presented by a second tab as a benign race
instead of theft.

## 5. The collaboration protocol

### Document layout

Each note is one `Y.Doc` (Hocuspocus document name = note id) with two shared types:

| Field | Type | Bound to |
| --- | --- | --- |
| `default` | `Y.XmlFragment` | Tiptap/ProseMirror editor body (via `@tiptap/extension-collaboration`) |
| `title` | `Y.Text` | the title `<input>` (minimal diffs, caret transformed through remote deltas) |

Using a CRDT (instead of OT or last-write-wins) is what makes requirement 1 hold: concurrent
inserts at the same position are ordered deterministically on every replica and nothing is
discarded. The collab suite inserts 120 characters concurrently from three clients at random
positions and asserts every replica, the server and the persisted state contain all of them.

### Handshake: collaboration tickets

```mermaid
sequenceDiagram
  participant B as Browser
  participant A as API
  participant C as Collab
  participant DB as Postgres
  B->>A: POST /notes/:id/collab-ticket (cookie + CSRF)
  A->>DB: membership(user, note)?
  A-->>B: { token: JWT{sub, nid, aud:"syncnotes-collab"}, exp 60 s }
  B->>C: WebSocket + Auth(token)
  C->>C: verify signature, audience, issuer, expiry, nid == document
  C->>DB: role = membership(sub, nid)   ← fresh read, the ticket's word is not enough
  C-->>B: authenticated (read-only if VIEWER) + sync step 1/2
```

Why a ticket instead of sending the access cookie to the WebSocket server?

- the access token stays `HttpOnly` — JavaScript never sees it;
- a ticket is bound to one note and signed with a **different secret and audience**, so a
  leaked ticket is useless against the REST API or another document;
- the provider calls the ticket function on **every reconnect**, so a session that outlives
  the 60-second ticket simply fetches a new one (and loses access the moment the API refuses).

## 6. Authorisation on a live WebSocket

Checking permissions only at connect time is not enough: the hard case is a user whose access
changes **while their socket is open**. SyncNotes layers four mechanisms:

```mermaid
flowchart TB
  E[Owner removes / downgrades a member] --> API
  API -->|1. commit to Postgres| PG[(Postgres)]
  API -->|2. publish access event| R[(Redis)]
  R -->|push, ~ms| C[every collab instance]
  C -->|removed| X[send access.revoked + close document connection]
  C -->|role changed| Y[flip connection.readOnly in place + notify client]
  C -.->|3. every inbound message re-checks role<br/>cached ≤ PERMISSION_CACHE_TTL_MS| PG
  C -.->|4. sweep: every open connection re-checked<br/>every PERMISSION_SWEEP_INTERVAL_MS| PG
```

1. **Handshake** — the role is read from Postgres; viewers get a read-only connection.
   Hocuspocus drops sync updates from read-only connections *on the server*, so a modified
   client that ignores the disabled editor still cannot change the document.
2. **Push** — membership changes are published on Redis; every instance applies them to its
   open connections immediately (close on removal, toggle `readOnly` on role change).
3. **Per-message check** — `beforeHandleMessage` re-checks the role on every inbound message
   through a cache with a short TTL (default 5 s). A revoked user can therefore not *write*
   for longer than the TTL, even if the Redis event is lost.
4. **Sweep** — the per-message check only runs when a client *sends* something. A connection
   that stays silent (a tampered client, or a normal one between its 15-second presence
   renewals) would keep *receiving* updates after its access was revoked whenever the event
   is lost — and Redis Pub/Sub is at-most-once, so events are never replayed after an outage.
   Every 5 s the server therefore re-reads the memberships of all connected users (one query
   per open document) and closes or downgrades connections accordingly; it also sweeps
   immediately when the access-event stream reconnects.

If Postgres is briefly unreachable the last known role is used; if nothing is known the server
fails closed. **Bound:** with events lost, a revoked user may read for at most
`PERMISSION_SWEEP_INTERVAL_MS` and write for at most `PERMISSION_CACHE_TTL_MS`.

**A subtle CRDT consequence.** Yjs requires causal delivery. When the server drops an update
from a client that became read-only, that client's clock now has a gap; everything it sends
afterwards depends on the dropped update and is *held back* by every other replica forever.
The server stays correct (the test suite verifies this), but the client would silently stop
syncing. The web client therefore **discards its local replica (memory + IndexedDB) and
resyncs from the server whenever its write permission changes.**

## 7. Persistence

- Hocuspocus calls `onStoreDocument` debounced (2 s, at most every 10 s) and on unload.
- **Merge-on-write under a row lock**:

  ```sql
  BEGIN;
  SELECT ydoc_state FROM notes WHERE id = $1 FOR UPDATE;
  -- Y.applyUpdate(liveDoc, persistedState)   ← pull in anything another instance stored
  -- state = Y.encodeStateAsUpdate(liveDoc)    ← union of both
  UPDATE notes SET ydoc_state = state, title = …, excerpt = …, plain_text = … WHERE id = $1;
  COMMIT;
  ```

  Yjs merges are commutative and idempotent, so concurrent stores from different instances can
  never overwrite each other (classic lost-update), and anything merged in is broadcast to that
  instance's clients. This is also why the Redis extension's distributed lock is disabled:
  the official extension *aborts persistence* when it cannot acquire its Redlock, which would
  mean "Redis down ⇒ edits not saved".
- Graceful shutdown flushes pending stores before the process exits, so deploys and restarts
  do not lose the last seconds of typing.

## 8. Offline editing and reconnection

```mermaid
stateDiagram-v2
  [*] --> Connecting
  Connecting --> Synced: authenticated + sync step 2
  Synced --> Offline: window 'offline' event
  Synced --> Reconnecting: socket closed
  Offline --> Connecting: window 'online' event
  Reconnecting --> Connecting: backoff timer
  note right of Offline
    edits go to the Y.Doc and IndexedDB
    unsynced counter shown in the UI
  end note
```

- Every editor keeps a **local replica in IndexedDB** (`y-indexeddb`), namespaced by
  `userId:noteId`, so edits survive closing the tab while offline. Viewers do not keep one.
- The client listens to the browser's `online`/`offline` events and disconnects/reconnects the
  provider immediately instead of waiting for a dead TCP connection to time out.
- On reconnect the Yjs sync protocol exchanges state vectors and each side sends exactly the
  updates the other is missing — offline edits and concurrent online edits merge without
  conflicts.
- Logging out deletes all cached replicas of that user from the device; revocation and
  deletion delete the affected note's replica.

## 9. Horizontal scaling and Redis failure

The Docker deployment runs two collaboration instances behind nginx round-robin, so two
people editing the same note are usually connected to *different* processes. The Hocuspocus
Redis extension relays document updates and presence between instances.

Redis is treated as a **latency optimisation, not a source of truth**: Postgres holds every
committed edit and every membership, so losing Redis can make the system slower, never wrong.
Tests place a TCP proxy between the instances and Redis and cut it
(`apps/collab/test/scaling.test.ts`).

### What still holds while Redis is down

| Property | Guarantee | Mechanism |
| --- | --- | --- |
| No acknowledged edit is lost | **Yes** | Persistence never touches Redis; merge-on-write under a Postgres row lock. |
| Users on the **same** instance collaborate in real time | **Yes** | Local WebSocket fan-out is independent of Redis. |
| Users on **different** instances converge | **Yes, eventually** | Each store merges the persisted state; the reconciler pulls newer state every `DEGRADED_RECONCILE_INTERVAL_MS` (3 s). |
| Opening a document | **Yes** | Redis subscription deferred until recovery. |
| Revoked user cannot write | **Yes, within 5 s** | Per-message check with TTL cache. |
| Revoked user stops receiving | **Yes, within 5 s** | Permission sweep. |
| Recovery without replaying a backlog | **Yes** | On reconnect each instance re-announces its state vector per open document; peers send exactly the missing updates. Documents closed during the outage are unsubscribed at recovery. |

### What Redis is needed for (not guaranteed during an outage)

| Lost or degraded | Impact | Bound / recovery |
| --- | --- | --- |
| **Real-time** sync *across* instances | Collaborators on different instances see each other's edits late. | Typically 2–5 s; worst case while someone types non-stop ≈ `STORE_MAX_DEBOUNCE_MS` (10 s) + reconcile interval (3 s). Real-time resumes < 1 s after recovery. |
| **Presence** (cursors, avatars) across instances | Remote cursors of users on the other instance disappear or freeze. Presence is ephemeral and never written to Postgres. | Restored on the next awareness update after recovery (cursor move or the 15 s renewal). |
| **Stateless notifications** across instances (`versions.changed`, "X restored a version") | Users on the other instance are not notified; the restored *content* still arrives via reconciliation, and the history list refreshes on its next fetch. | Not replayed. |
| **Immediate** revocation / role change | Push events published by the API during the outage are dropped. | Bounded by the sweep and TTL above; never replayed, not needed. |
| "Saved" indicator meaning | "Saved" means *acknowledged by your instance*, not *visible to users on other instances*. | — |

### Asymmetric partitions

Redis health is observed **locally**. If instance B loses Redis while instance A does not, A
has no reason to enter degraded mode — and its idle users would never see B's edits (A only
merges persisted state when it stores something itself). An **anti-entropy pass** therefore
runs through Postgres every `ANTI_ENTROPY_INTERVAL_MS` (15 s) even while healthy. It reads one
timestamp per open document and fetches state only for documents another instance has written
since; applying already-known state is a no-op. Covered by
*"converges during an asymmetric partition"* in the scaling suite.

### Outside this guarantee

- **Redis and Postgres both down**: edits stay in the clients (memory + IndexedDB) and in the
  collaboration server's memory; nothing new is persisted until Postgres returns. If a server
  crashes in that state, its clients re-send their state on reconnect.
- **A client offline and an instance crash at the same time** only loses edits that existed
  nowhere else — the same as any system without synchronous replication.

The Redis extension is wrapped (`ResilientRedisExtension`) rather than forked: it disables the
lock, skips publishes while disconnected (instead of queuing them without bound), never lets a
document load block on Redis and finishes deferred subscription work on recovery — using only
the extension's public hooks.

## 10. Version history

- **Snapshots** are history-free content copies (`Y.Doc` with cloned body + title) stored as
  binary updates. Created manually (named) or automatically at most every 10 minutes during
  editing (auto snapshots are pruned to the latest 50).
- Snapshots are created and restored by the **collaboration server**, the only place where the
  live document exists, via stateless messages on the authenticated connection (editor role
  re-checked without cache).
- **Restore is a forward edit**, not a state overwrite: the server deletes the current content
  and inserts a copy of the snapshot inside one transaction. Overwriting the stored state would
  be undone the moment any client with the newer state reconnects; a forward edit propagates to
  online *and* offline replicas like any other change. The pre-restore content is saved first
  (`RESTORE` snapshot), so a restore can itself be undone.
- Previews are rendered client-side from the binary snapshot with the same editor schema, so
  what you preview is exactly what you restore.

## 11. What the tests prove

| Requirement | Verified by |
| --- | --- |
| Concurrent edits never lose updates | `collab/test/collaboration.test.ts` — 3 clients × 40 random-position inserts; replicas, server and DB identical |
| Viewer cannot modify, enforced server-side | `collab/test/collaboration.test.ts` (raw provider sends updates anyway) + `web/e2e` (UI read-only) |
| Revoked user's open session stops editing | `collab/test/revocation.test.ts` (push), TTL fallback without event, `web/e2e` revocation |
| Revoked *silent* reader stops receiving when the event is lost | `collab/test/revocation.test.ts` (permission sweep — demonstrates the gap, then closes it) |
| Live downgrade / upgrade without reconnect | `collab/test/revocation.test.ts` |
| Clock-gap safety after rejected updates | `collab/test/revocation.test.ts` |
| Binary persistence, derived columns | `collab/test/persistence.test.ts` |
| Data survives a server restart | `collab/test/persistence.test.ts` |
| No lost updates across instances (merge-on-write) | `collab/test/persistence.test.ts`, `collab/test/scaling.test.ts` |
| Offline edits merge on reconnect | `collab/test/persistence.test.ts`, `web/e2e` (`setOffline`) |
| Offline edits survive closing the tab | `web/e2e` (IndexedDB) |
| Multi-instance sync of content and presence | `collab/test/scaling.test.ts` |
| Redis outage behaviour + recovery | `collab/test/scaling.test.ts` (TCP proxy cut/restore) |
| Asymmetric partition (one instance loses Redis) | `collab/test/scaling.test.ts` (anti-entropy) |
| Document closed during the outage re-opens and syncs in real time | `collab/test/scaling.test.ts` |
| Ticket validation (signature, expiry, audience, document, membership) | `collab/test/auth.test.ts`, `api/test/sharing.int-spec.ts` |
| Auth hardening (cookies, CSRF, lockout, rotation, reuse detection, logout) | `api/test/auth.int-spec.ts`, unit specs |
| Role hierarchy and 404/403 semantics on REST | `api/test/notes.int-spec.ts`, `api/test/sharing.int-spec.ts` |
| Version snapshot / restore / permissions | `collab/test/versions.test.ts`, `web/e2e` |

## 12. Trade-offs and future work

- **Auth DB lookup per request.** Checking the session family on every request makes logout
  instant at the cost of one indexed query; a Redis-backed revocation list would remove it.
- **Rate limiting is per process.** `@nestjs/throttler` uses in-memory storage; with several
  API replicas it should move to Redis storage.
- **Full-state writes.** Each store writes the whole document state. For very large documents
  an append-only update log with periodic compaction would reduce write volume.
- **Restore semantics.** Edits an offline user made to content that was later replaced by a
  restore are superseded (the pre-restore snapshot keeps them recoverable).
- **Offline cold start.** Edits continue while the app is open and survive a tab close, but
  opening the app from scratch without a network needs a service worker (PWA) — not built yet.
- **Invitations** currently require an existing account; pending e-mail invitations would need
  an outbox + mailer.
