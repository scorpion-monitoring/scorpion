# ADR-0012: Mail tokens, mail ordering and the Mailer port

- Status: Accepted
- Date: 2026-10-02

## Context

M2 sprint 5 finishes the account lifecycle: password reset, password change and email verification (FEATURES §3.1
lists them as missing). Each needs a secret that travels by email, and email is the one channel M2 has no module for
(`core.notifications` is M4). The sprint plan (§1, §11) decided on a `Mailer` port with an SMTP implementation over
Nodemailer and an in-memory one for tests. This ADR fixes what a mailed token is, when the mail goes out, and what
the answers may reveal.

## Decision

- **Tokens.** `srt_` (reset) or `sev_` (verification), then 256 random bits as base64url. Only the SHA-256 hash is
  stored, in `identity_mail_token (purpose, secret_hash, email, expires_at, used_at)`. SHA-256 is enough because the
  secret has full entropy, as for sessions (ADR-0007); a slow hash would cost a login's worth of CPU per unauthenticated
  request for nothing. The row is found by the hash through a unique index and the hash is compared again with
  `timingSafeEqual`. A reset token lives 1 hour, a verification token 24 hours.
- **Single use.** One `update … set used_at = now() where hash = … and used_at is null and expires_at > now()
returning`. Two requests with the same link cannot both succeed. It runs in the transaction that does what the
  token allows, so a failure (the event cannot be written, a taken address) rolls the use back and the link works
  again. A new token for the same user and purpose deletes the outstanding one, so only the newest link works. A
  successful reset or verification deletes every outstanding token of that purpose for the user.
- **One refusal.** An unknown, malformed, used, expired or wrong-purpose token, and a token of an account that can no
  longer use it, are the same **400** with one message. A weak password is a **422** and does not use the link up (the
  token is checked first, without being used, so a bad link never costs an argon2 hash).
- **The request never reveals.** `POST /auth/password-reset` answers 202 `{ accepted: true }` for every well-formed
  address. A reset goes only to an `active`, non-deleted account with a password method; an OIDC-only, pending,
  rejected or deleted account and an unknown address get nothing, and the answer is the same. Each address has a mail
  budget in the rate limiter (3 an hour, keyed by the hash of the lower-cased address) that is spent for unknown
  addresses too, so exhausting it says nothing. Timing is equalised as far as practical: both paths write to the
  limiter and run the same lookup; only the known path also writes a token, and the mail transport is never waited for.
- **Mail after the commit, not waited for.** The token is stored in a transaction together with its event. The mail is
  handed to the transport **after the commit** (never for a rolled-back write) and **detached**: the request answers
  without waiting for SMTP, because a response that waits only for addresses that exist would be a timing oracle. A
  failed send is logged as `{ kind, reason: <error code> }` and nothing else; the person asks again, and the
  replacement invalidates the lost one. A crash between commit and send loses one mail, which is the price of having no
  queue; `core.notifications` (M4) brings the outbox and retries.
- **What the mail holds, what the log holds.** The link is `<ORIGIN><BASE_PATH>/reset-password#token=…` (or
  `/verify-email`). The token is in the **fragment**: it is not sent to the server, so not in an access log, a proxy
  log or a `Referer`. The page (M5) reads it and posts it. The token appears in the mail only: not in a response, an
  event, an error or a log line. A test captures the log stream and proves it. Without `SMTP_URL` the mailer refuses to
  send and the log says only that an email was not sent, with its kind.
- **Sessions.** A reset or a password change revokes every session of the user in the same transaction, through
  `sessions.revokeAll(userId, tx)`, and once more after the commit so this process's cache is emptied after the
  revocation is visible (the bound across processes stays the cache TTL, ADR-0007). The caller's own session ends too:
  the browser signs in again.
- **Access tokens are not touched** by a reset or a change (the plan says sessions only). A PAT is a separate
  credential with its own revocation and owner-visible list; revoking all of them would break scripts silently. The
  trade-off is that a PAT an intruder minted from a hijacked session survives the recovery until the owner revokes it.
  An option "revoke tokens on reset" is in the backlog.
- **`localAccounts`.** Reset (both steps) and password change are password features and answer 403 when the setting is
  off, like register and login. Verification is not gated: an OIDC-only person has an address too.
- **Verification and OIDC (changes the sprint 4 rule).** Registering a password account sends a verification mail. Until
  the owner opens the link the address is unverified and an OIDC login with the same address answers 409. After it, the
  account is linkable by a provider that vouches for that address (ADR-0011).
- **The Mailer port.** `send(mail)`, with SMTP (Nodemailer, `SMTP_URL`), in-memory (tests) and "unconfigured"
  implementations in `modules/core-identity/service/mailer.ts`. Plain text only, no templates, no queue. M4 moves the
  port behind `core.notifications` and reuses the transport. The sender address and the instance name come from the
  identity settings `mailFrom` and `instanceName` until core.settings exists (rule 9: no hard-coded branding).
- **Nodemailer** is the one new runtime dependency (the plan pulled it forward from M4).

## Consequences

- No UI exists before M5, so the links point to pages that do not exist yet. The fragment contract (`#token=…`) and the
  two confirm routes are the interface M5 builds on.
- A register request still answers 409 for a taken username or address (kept from sprint 2; see the backlog). The new
  routes never do.
- Mail budgets live in `kernel_rate_bucket` under `identity.mail:` and `identity.verify:` keys; the kernel prunes them.
