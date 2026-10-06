# ADR-0025: Absolute session lifetime and recent authentication

- Status: Accepted
- Date: 2026-10-06
- Amends: [ADR-0007](0007-session-cookie-and-csrf.md) (session lifetime), [ADR-0011](0011-oidc-login.md) (a second purpose of the login state)

## Context

M4a found three gaps in the sessions of `core.identity` (ASVS 5.0 chapter V7):

- The expiry slides on every use and nothing consults `createdAt`, so a session that is used often never ends (7.3.2).
- A signed-in session is enough to change the email address, to link another sign-in provider, or to end other sessions.
  ASVS 7.5.1 asks for a full re-authentication before such changes (7.5.1, 7.5.2).
- There is no way to tell whether an OIDC provider still knows the person (7.6.1), and an account that has no password
  has nothing to re-authenticate with except the provider.

Decisions 4, 6 and 10 of the M4b plan are taken: recent authentication through the session (password, or a fresh OIDC
login with `auth_time` for an account without a password), no cap on concurrent sessions, 7 days of inactivity and
30 days absolute as settings.

## Decision

### 1. Two lifetimes, both settings

`identity_session` gets `absolute_expires_at`, set from `created_at` when the session is created. The `core.identity`
settings `sessions.inactivityDays` (default 7) and `sessions.absoluteDays` (default 30; never less than the inactivity
period) are read through the settings port when a session is created. The row keeps the value it was created with: a
later change of the setting applies to new sessions.

`sessions.resolve` refuses a session whose `absolute_expires_at` has passed, and the sliding `expires_at` is
`min(now + inactivity, absolute_expires_at)`, so the session cannot be kept alive beyond the cap by using it. The cookie
is sent again with the new `expires_at`. The 5-second cache of ADR-0007 may serve a session for at most 5 seconds after
the absolute end, like a revocation in another process; that is the same bound and is stated in
`docs/security/sessions.md`.

The migration backfills `absolute_expires_at = created_at + 30 days` for existing rows. A session created more than
30 days before the upgrade therefore ends at the first request after it. That is a behaviour change and has a changeset.

### 2. Recent authentication

`identity_session.authenticated_at` is when the person last proved who they are in this session: set to the creation
time at login (password or OIDC), set to the time of a successful re-authentication afterwards. It is read from the
database when it is needed (not cached), so a re-authentication is effective at once in every process.

`requireRecentAuth(actor, maxAgeSeconds?)` is a function of the session service, exposed to other modules through the
public service of `core.identity`. The window defaults to the setting `sessions.recentAuthSeconds` (300). It throws
`ReauthenticationRequired`, a `DomainError` with status 401 and the problem type `reauthentication-required`
(`DomainError` gets an optional `type`; the error mapper writes it into the problem). Rules:

- It applies to session actors. A personal access token is a credential the person created on purpose (ADR-0008),
  has no `authenticated_at`, and cannot reach the session-only actions anyway; a token caller is not asked.
- A session actor without a session id, or whose session is gone, fails closed: 401.
- It is checked **in the service**, before the work and before any rate limit is spent, never only in the route.

Required before: an email change (`PATCH /account/profile` with a new `email`), starting the link of another sign-in
provider, ending a session from the list, and "log out everywhere". Not required to read the list, to log out the
current session, or for the administrators' routes.

### 3. How to re-authenticate

- **Account with a password:** `POST /account/reauthenticate` with `{ password }`. The password is checked against
  the stored hash; a wrong one is a 422 (like changing the password), the route is rate limited (`strict`) and audited.
  Success sets `authenticated_at` of the caller's session to now.
- **Account without a password** (or one that prefers its provider): `POST /account/reauthenticate/oidc/{provider}`
  starts the same flow as a login with a login state whose **purpose is `reauth`** (and the id of the session it is
  for). The authorisation request carries `prompt=login` and `max_age=0`. The caller must have a sign-in at that
  provider (otherwise 404). The provider's callback is the existing one.

### 4. The login state's purpose (amends ADR-0011)

`identity_login_state` gets `purpose` (`login`, `link` or `reauth`; a check constraint) and `reauth_session_id`. For
`link` and `reauth` the existing `link_user_id` holds the signed-in user who started the flow. The purpose is read from
the **stored row**, never from anything the browser sends, so a callback cannot turn a login into a re-authentication
or the reverse. The state stays single use, 10 minutes, bound to the browser by the PKCE cookie.

At the callback of a `reauth` state, after the id_token has passed every check of ADR-0011:

1. `auth_time` must be present and a number. A missing claim is a refusal: with `max_age` in the request the provider
   must send it (OIDC Core 3.1.2.1, 3.1.3.7 item 11).
2. `auth_time` must not be older than the time the state was created minus the 60 seconds of clock skew that the other
   time claims already allow (`CLOCK_SKEW_SECONDS`). A provider that ignores `prompt=login` and `max_age=0` and answers
   from its own single sign-on session sends an old `auth_time` and is refused.
3. The id_token's `sub` must equal the subject of the caller's own sign-in at this provider. Another account at the same
   provider does not re-authenticate this one.
4. The session named in the state must still be live and belong to that user; then `authenticated_at` is set to now.

No session is created or replaced, and the callback redirects to the application root as before. Failures are the
401 of ADR-0011 with a reason code in the log (`auth-time-missing`, `auth-time-stale`, `reauth-other-subject`).

### 5. Sessions in the actor

The actor of a session request carries `sessionId`, the id of the row (not the cookie value, so it is no secret).
Services use it for "this is the current session" and for `requireRecentAuth`. The list of sessions returns that id.

### 6. What is stored and shown (Decision 6)

No user agent, address or device name is stored. `GET /account/sessions` returns `id`, `createdAt`, `lastSeenAt` and
`current`. There is no cap on the number of sessions. An administrator can end the sessions of one user or of everybody
(permission `core.identity.session.manage-any`); `revoke-all` spares the caller's own session.

## Consequences

- Sessions end at 30 days whatever the use; people sign in again about monthly. Operators who want less set a setting.
- A provider that does not honour `prompt=login` leaves OIDC-only accounts unable to change their email address or to
  link another provider; they get a clear refusal (a stale `auth_time`). `docs/security/sessions.md` says so.
- The page that shows the 401 `reauthentication-required` and asks for the password or the provider is M5's.
- One more column read per sensitive request; nothing on the hot path (the cache keeps `sessionId`, not
  `authenticated_at`).
- An OIDC session is independent of the provider's after the login: ending it at the provider does not end it here
  (no back-channel logout, see `docs/security/sessions.md`).
