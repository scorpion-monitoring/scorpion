# ADR-0019: Module graph and the notifications port

- Status: Accepted
- Date: 2026-10-05

## Context

M4 adds `core.notifications` (mail and webhook delivery) and `core.audit`. `core.identity` sends the first mails (reset,
verification, welcome, approval) and is the module with the most sensitive ones: a reset link is a credential. FEATURES §2
draws the arrow "notifications subscribes to identity events". ADR-0003 allows a module to subscribe only to its own events and
to those of its dependencies, and ADR-0012 forbids a token in an event payload (events are stored, logged and shown to
auditors). Both cannot hold for a reset mail if notifications depends on identity: the event would have to carry the token,
or identity would need a private mail path next to the port.

## Decision

- **`core.identity` depends on `core.notifications`; `core.notifications` is user-agnostic**, exactly as `core.authz` is
  (ADR-0014). It stores an opaque `recipient_user_id` with no foreign key, imports nothing from identity and takes the
  recipient's address from the caller. A purge of a user is never blocked by a delivery row.
- **Module graph** (no cycle; left is depended on): `core.authz` ← `core.settings` ← `core.blob` ← `core.notifications`
  (declares authz and settings) ← `core.identity` (authz, settings, blob, notifications, from sprint 2) ← `core.audit`
  (authz, settings, identity; notifications as an optional peer, sprint 4). A profile lists dependencies first, and
  `defineProfile()` and `pnpm modules:sync` check it. Table prefixes `notify_` and `audit_` are set in the manifests (ADR-0004).
- **The port is `enqueue(tx, message)`.** The caller passes the transaction it is already in; the service throws outside
  `ctx.db.tx()` like `ctx.events.emit` (ADR-0003). The row is inserted in that transaction, so a rollback removes the mail
  and a commit guarantees it will be tried. This closes the "crash between commit and send" gap of ADR-0012.
  The port checks no permission: it is for trusted code, like the system methods of `core.authz` (ADR-0015) and
  `getSecret` of `core.settings` (ADR-0016). The trust boundary is the profile's module list.
- **Why notifications does not subscribe to identity events.** (1) A secret may not travel in an event. (2) An event would
  make the mail depend on an outbox dispatcher that is a second hop away from the request, so "the same transaction
  as the work" is lost. (3) Identity knows who the recipients are (all administrators, the owner of an address); notifications
  would have to ask identity, which is the cycle again. The reverse arrow also gives identity nothing to import
  that a one-way dependency does not.
- **Sensitive mail and what the scrub guarantees.** A message with `sensitive: true` (reset, verification) keeps its rendered
  `text_body` and `html_body` in the row only while it is `queued` or `sending`. The statement that moves the row to `sent` or
  `dead` sets both bodies to null in the same `UPDATE`. After that nothing in the database holds the token's link. The scrub
  guarantees: no sensitive body in a row that reached a final state, and none in a log line, an event, an error or a response
  (the service never logs a body, a subject or an address, and `last_error` holds a code, never a message). It does not
  guarantee anything about the mail itself once the relay has it, and a row that is stuck in `queued` or `sending` keeps its
  body until it ends. A sensitive message cannot go to the webhook channel (the webhook mirrors admin notifications, not
  credentials). A crash between the send and the scrub leaves a lease that expires and a second send of the same link; the
  token's single-use rule (ADR-0012) makes that harmless.
- **Settings and secrets.** The module's settings carry no password; the SMTP password and the webhook signing secret are
  stored in the secrets store as `notifications.smtp.password` and `notifications.webhook.secret` (ADR-0016) and read with
  `getSecret` at the moment a transport is built. `SMTP_URL` is not read by this module (M4 decision 7).

## Consequences

- Identity gains a dependency in sprint 2 and moves its `Mailer` port behind this one; until then nothing uses the module.
- A module that wants to mail someone resolves the address itself and enqueues in its own transaction. A module that has
  no address (a user without one) cannot use the email channel; the in-app inbox of sprint 3 is the other route.
- Profiles that list `core.identity` list `core.notifications` before it from sprint 2; sprint 1 adds the module to the
  profiles that already list identity, with nothing depending on it yet.
- FEATURES §2's arrow notifications → identity is not followed, as for authz.
