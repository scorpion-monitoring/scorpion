# ADR-0008: Personal access tokens

- Status: Accepted
- Date: 2026-10-02

## Context

Sprint 3 of M2 adds personal access tokens (PATs) for scripts and for the public API. Defect 3
(FEATURES §5): the old app answered a malformed API key with a 500. The authenticator contract
(ADR-0006) already says bad credentials are a 401; this ADR fixes the format, how a token is
checked, and the decisions the sprint plan leaves open.

## Decision

### Format and storage

- A token is `scp_<prefix>_<secret>`: a fixed mark, an 8-character `[A-Za-z0-9]` prefix and a 43-character
  base64url secret (256 random bits), 56 characters in all. The parser accepts exactly that and
  returns "invalid" for anything else, without throwing. The prefix finds the row (unique index);
  the secret is stored only as an argon2id hash (the password wrapper, same parameters).
- The existing log masking (`scp_<8>_<secret>`) already catches the format, so a token that
  reaches a log line by mistake is masked there as well.
- **Scopes** were `read:<resource>` or `write:<resource>` (`read:kpi`) in M2, checked in shape only and granting and
  limiting nothing. **Superseded by [ADR-0015](0015-identity-on-authz.md):** a scope is the id of a permission
  (`core.identity.me.read`), at most 20 per token and 100 characters each, at least one per token, and a token can do
  what its scopes name and its owner holds.
- A token name is unique per user **among tokens that are not revoked** (a partial unique index,
  migration `0001`). Revoking keeps the row, which frees the name, and rotating needs that.

### Checking a token

- Lookup by prefix, then argon2id verification. For an unknown prefix the same verification runs
  against a decoy hash, and for a revoked, expired or ownerless token the verification runs
  before the verdict, so the answer and its cost do not tell the cases apart. A token whose owner is
  pending, rejected or soft-deleted is invalid.
- **Cache.** argon2id on every API call is too expensive (64 MiB, three passes), so a verified
  token is trusted for 5 seconds in this process, keyed by the SHA-256 of the whole token. Revoke
  and rotate drop the entries of this process at once; **another server process can accept a
  revoked token for at most 5 seconds**, the same bound as a session (ADR-0007). A wrong token
  is never cached, and neither is a malformed one, which is refused before any hashing. The cache
  honours the token's own expiry.
- `last_used_at` is written at most once a minute, after the response path, and a failed write is
  logged and ignored.

### Which request is a token request

- `Authorization: Bearer <token>` or `X-API-Key: <token>`; `Authorization` wins if both are there.
  Another scheme (Basic) is not ours and is ignored.
- **A request that presents a token is a token request and nothing else.** The session cookie is
  not looked at: it cannot lend session privileges, it cannot add a CSRF demand the caller could not
  meet, and a stale cookie cannot break a good token. A bad token is a 401 even when the cookie is
  good. A bearer token never counts as a cookie request, as ADR-0007 says, so it needs no CSRF token.
- A bad token on a `public: true` route means "not signed in", like any bad credential (ADR-0006).

### Managing tokens needs a session

- Creating, listing, revoking and rotating tokens are refused (403) when the caller used a token.
  A stolen token must not be able to mint a longer-lived one or hide its own tracks. People who only
  have a token manage their tokens from the web UI.
- Resource-scoped checks use `ctx.authz.require` from M3. Until then the service scopes every query
  to the caller's id, and an id that is someone else's is answered exactly like an unknown id
  (404), so the response does not reveal whether it exists. At most 50 live tokens per user.

### Rate limit for failed attempts

- The per-address and per-credential buckets of every route (pipeline step 2) charge good and bad
  requests alike. On top of them, a request that presents a bearer token or API key is checked against
  a **strict bucket of failures per client address** (burst of 10, then 10 a minute) _before_ the
  token is verified, and a failed attempt takes a token from it. An address that has used it up gets a
  429 with `Retry-After` for every token request, good or bad, until a token is back, so guesses are
  not answered. This applies on public routes too. The check is a read and the charge is a write, so
  parallel requests can overshoot by the number of requests in flight. This needs one small kernel
  addition, `RateLimiter.peek()`.

### Events

Create, revoke and rotate each emit an event through the outbox in the transaction that changes
the data: `identity.token.created@1`, `identity.token.revoked@1` and `identity.token.rotated@1`
(`{ userId, tokenId, name }`, rotated adds `previousTokenId`). No token, prefix, hash or scope is in
a payload. Rotation revokes one row and inserts another, so it is a multi-row write by rule; the
other two are emitted for the same reason `core.notifications` (M4) will want them: "a token was
created on your account" is a security notice.

## Consequences

- A person who loses a token creates a new one; nobody can read an old one.
- With several server processes, a revoked token works for up to 5 more seconds on the other
  processes. Set `tokenCacheTtlMs` to 0 for strict behaviour (tests do).
- The failure bucket is a constant for now (`FAILED_CREDENTIAL_LIMIT`); it moves to settings in M3.
