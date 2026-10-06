# ADR-0007: Session cookie and CSRF protection

- Status: Accepted
- Date: 2026-10-02

## Context

Sprint 2 of M2 gives browsers a session (defect 4: a copied cookie must stop working after logout).
A cookie is sent by the browser without being asked, so a page on another site can make the browser
send it with a forged request. Cookie-authenticated writes need a defence, and personal access tokens
(sprint 3) do not, because a script has to attach them on purpose.

The web UI (SvelteKit, M5) calls the API from the same origin through the generated client, and it
cannot read an HttpOnly cookie.

## Decision

### The cookie

- Name `__Host-session`: the browser accepts it only with `Secure`, `Path=/` and no `Domain`, so a
  sibling subdomain cannot plant or overwrite it. Attributes: `Secure; HttpOnly; SameSite=Lax; Path=/`,
  `Expires` set to the session's expiry.
- The value is the session id: 256 random bits, base64url (43 characters). The database holds only its
  SHA-256 (`identity_session.secret_hash`).
- `Path=/` is required by the prefix, so the cookie is sent to the whole host whatever `BASE_PATH` is.
  One deployment per host name (or per sub-path of a host) shares the cookie jar of that host; two
  instances on one host would overwrite each other's cookie. That is accepted: it is one product per
  host.
- Expiry slides: 7 days after the last use. The database is written at most once a minute per session,
  and the cookie is sent again when it is.

### CSRF: a per-session token in a header, on top of `SameSite=Lax`

- **Rule.** A request that carries the session cookie and uses a method other than `GET`, `HEAD` or
  `OPTIONS` must also carry `X-CSRF-Token` with the token of that session. The authenticator checks it
  as part of turning the cookie into an `Actor`, so every module's cookie-authenticated write is
  protected without a line in the module. A wrong or missing token is a 401 problem response (and, on a
  `public: true` route, the caller is simply treated as not signed in, like any other bad credential).
- **Token.** `base64url(SHA-256("scorpion:csrf:v1:" + sessionId))`. It is derived, not stored: no new
  column, nothing to rotate, nothing to clean up. Only someone who holds the session id can compute it,
  and it cannot be computed from the stored hash. It is compared in constant time.
- **Delivery.** `POST /auth/login` and `GET /auth/me` return it as `csrfToken`. The UI keeps it in
  memory and sends it as a header from its API client; it asks `/auth/me` again after a reload.
- **Requests without the cookie** (personal access tokens, anonymous calls) have nothing to forge and
  skip the check. A bearer token never counts as a cookie request.
- **JSON only.** Every write route accepts `application/json` bodies only. A cross-site HTML form can
  send only `application/x-www-form-urlencoded`, `multipart/form-data` or `text/plain`; those are refused
  (415/422). A cross-site `fetch` with a JSON body needs a CORS preflight, which the server never grants.
  This also stops login CSRF (an attacker signing the victim in as the attacker).
- **Why not only `SameSite=Lax`.** It is the first layer, and the second is cheap. `Lax` still sends the
  cookie on same-site requests from a sibling subdomain, and browsers differ at the edges (some browsers
  send `Lax` cookies on top-level cross-site POSTs for a short time after they are set). A token closes those gaps.
- **Why not an `Origin` check.** It would need the exact public origin configured and correct behind
  every proxy; a wrong value would lock everyone out. `ORIGIN` exists in the config, but nothing
  depends on it being right today. It stays a possible extra layer (`docs/backlog.md`).
- **Why not the double-submit cookie.** It needs a second, readable cookie and is weaker against a
  subdomain that can set cookies; the derived token needs no cookie at all.

### Sessions and the cache (defect 4)

- The authenticator asks the session service on every request that carries the cookie, public routes
  included. The service answers from a short in-process cache (5 seconds, keyed by the hash) and
  otherwise from the database, which also checks that the user is still `active` and not deleted.
- Logout and "log out everywhere" revoke in the database and empty the cache entries of this process at
  once. **Another process learns of it when its cache entry expires, so with several server processes a
  revoked session can still be accepted by another process for at most 5 seconds.** That bound is the
  cache TTL and is stated in the module README. A revocation that races with a lookup is not cached
  (a counter changes on every invalidation).
- Unknown ids are never cached, so a flood of invented cookies costs a database lookup each; the rate
  limiter (per address) is the guard.

## Consequences

- The UI's API client must send `X-CSRF-Token` on every write; tests and `curl` users do too, until
  they use a token.
- Every module gets CSRF protection for free, and a module cannot forget it. A module that
  changed state on a `GET` would bypass it; a `GET` must never change state.
- A 401 for a missing CSRF token means the UI cannot tell "session ended" from "token missing" by the
  status. The problem `detail` says which; the UI refreshes `/auth/me` on a 401 and redirects to login
  only if that fails too.
- Sessions that other processes may accept for 5 seconds after a revocation are the price of one lookup
  per request not being one query per request. Set the TTL to 0 (tests do) for strict behaviour.

## Update (M4b sprint 1)

[ADR-0025](0025-absolute-session-lifetime-and-recent-authentication.md) amends the cookie's expiry: it still slides, but never
beyond an absolute end (`absolute_expires_at`, 30 days by default; the 7 days are the inactivity period, also a setting).
The actor of a session request carries the id of the session row, and sensitive changes need a recent authentication.
