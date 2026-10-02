# ADR-0013: Cleanup job and retention rules

- Status: Accepted
- Date: 2026-10-02

## Context

`core.identity` leaves rows behind that can never be used again: expired sessions, login states, mail tokens and access
tokens. Sprint 2 also soft-deletes rejected accounts and keeps their usernames reserved, with the question of when that
ends left open (backlog: "decide on a retention rule with the purge of soft-deleted users (sprint 5)"). The architecture
lists an hourly cleanup for `core.identity`.

## Decision

- **One job, `core.identity.cleanup`,** declared in the manifest, `0 * * * *` UTC, 2 retries, 5 minutes. It runs through
  the jobs facade (`scorpion worker`, or inline in the web process). The handler calls `cleanup.run(now)`; the clock is a
  parameter, so tests control it.
- **One run is one transaction.** A failure rolls everything back, including the events of a purge; the next hourly run
  does it again. Volumes are small (hourly); the purge takes at most 500 accounts per run so a transaction stays short.
- **Spent or expired rows are deleted at once:** sessions (expired or revoked: lookups are by hash, so a revoked row
  authenticates nothing and has no use), login states (expired), mail tokens (used or expired; the mail budget lives in
  the rate limiter, not in these rows), first-run tokens (expired).
- **Access tokens keep a grace period of 30 days** after they expire or are revoked, because the owner's token list shows
  them (as expired) and a token that vanishes the hour it expires looks like a bug. After that the row, the prefix and
  the name are freed.
- **Purge of soft-deleted accounts after 30 days** (`PURGE_RETENTION_MS`, a module constant until M3 settings). The
  only soft-deleted accounts in M2 are rejected applications. A purge deletes the user row; the auth methods, sessions,
  access tokens, mail tokens and login states go by `ON DELETE CASCADE`. It **frees the username and the address**: a
  rejected applicant may apply again after the retention period, and until then the username stays reserved (the sprint
  2 rule). A live account is never purged.
- **What it keeps:** outbox events about the account (`registered`, `rejected`). Events are history and have their own
  retention (backlog). The username in them can later belong to someone else; events carry the user id as well.
- **A purge announces itself.** `identity.user.purged@1 { userId, username }` is emitted in the same transaction, just
  before the delete. Other modules that keep rows about users (M3 role assignments, later memberships) subscribe and delete
  or anonymise them. Their foreign keys to `identity_user` must therefore not block the delete; each module documents
  how it reacts in its README.
- **No actor.** The job has no route and no permission. It logs counts, never ids, names or addresses.

## Consequences

- The username of a purged account can be registered by someone else. Anything that must keep pointing at "the same
  person" has to use the user id, not the name.
- If a later module's table references `identity_user` with `ON DELETE RESTRICT`, the purge fails (and rolls back) until
  that module handles the event; the failure shows in the job history, which is the intended alarm.
- 30 days and 500 per run are constants; M3 moves them to settings.
