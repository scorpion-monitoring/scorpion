# ADR-0010: First-run token and bootstrap administrator

- Status: Accepted
- Date: 2026-10-02

## Context

The old app made the first registrant an administrator (defect 1). M2 drops that rule. A fresh install needs a
first administrator without roles (M3) and without a mail server (M4). ADR-0006 fixed that the temporary
`identity_user.is_bootstrap_admin` column marks the administrator and that nothing may read it.

## Decision

- **Two ways in, one service.** `scorpion create-admin` (an operator with a shell, ADR-0009) and a one-time
  first-run token (an operator who can see the server's console). Both end in
  `BootstrapService.createAdmin()`: an active local account, the marker, the end of every outstanding first-run
  token and the event `identity.admin.created@1 { userId, username, origin }` in one transaction.
- **Setting the marker without mentioning it.** `db/schema.ts` exports `BOOTSTRAP_ADMIN_MARK`, a value
  (`{ isBootstrapAdmin: true }`). The bootstrap service passes it to `.set()`; no other file mentions the
  column, so the existing test (only `db/schema.ts` names it) still holds unchanged, and a second test pins
  that the constant is used in one place only, as the argument of an update. Nothing reads the column and
  nothing decides by it.
- **"No administrator yet" without the column.** An install has no administrator exactly when it has no
  active, non-deleted user: with the `manual` approval policy an account becomes active only through an
  approver (who must already be an administrator) or through these two paths. The check issues and redeems
  the first-run token; M3 replaces it by "no user holds the Admin role". A later approval policy that
  activates accounts automatically has to take this into account then; the bootstrap path simply stops being
  offered, which is the safe side.
- **The token.** `sfr_` and 256 random bits (a different mark from access tokens, so the log masking and a
  human can tell them apart). Stored as a SHA-256 hash in `identity_first_run_token`, single use, valid for 1
  hour. It is issued on `system.ready` when there is no active user and no token that is still good, under an
  advisory lock, so processes starting together issue one. A failure to issue is logged and does not stop
  the start-up.
- **Where it is shown.** After the transaction commits, once, as a plain-text block on the process's standard
  error. **This is the one secret that may be printed**, and it is written with `process.stderr.write`, never
  through the structured logger (whose JSON lines are shipped and kept). Nothing else repeats it: not a later
  line, not a response, not an event, not the database. A restart with the token still outstanding cannot show
  it again (only the hash is kept) and says so, without the secret, in the structured log. Under
  `NODE_ENV=test` the default shows nothing, as the password hashing uses cheap parameters there.
- **Redeeming.** `POST /api/internal/bootstrap/first-admin { token, username, email, password }` is public
  (reason in the route) with the strict rate limit. The token is used up by an update in the same
  transaction that creates the account, so a taken username (409) or an invalid input (422) leaves it usable
  and a failure of the event rolls the use back. An unknown, used, expired, malformed token, or any token once
  an active user exists, is the same 401.
- **create-admin and the password.** Read from the prompt or standard input, never from `argv` (ADR-0009).

## Consequences

- The first-run token is printed by whichever process of the install starts first (the web server, or the
  worker if it starts first): look at the logs of both, or use `create-admin`.
- If the token's only copy is lost (the output was not captured) the install waits up to an hour, or the
  operator runs `create-admin`.
- M3 changes two things: the "no admin" check, and the drop of the marker column (with the migration of
  existing markers to the Admin role).
