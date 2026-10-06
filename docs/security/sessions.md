# Session policy

How long a Scorpion session lives, how many a person may have, how it relates to an identity provider's session, and when
a person must prove who they are again. It documents what the code does and why; the decisions are
[ADR-0007](../adr/0007-session-cookie-and-csrf.md) (cookie, CSRF, cache) and
[ADR-0025](../adr/0025-absolute-session-lifetime-and-recent-authentication.md) (two lifetimes, recent authentication). The
module's routes and settings are in [modules/core-identity/README.md](../../modules/core-identity/README.md). This page backs
ASVS 5.0 requirements 7.1.1, 7.1.2, 7.1.3, 7.3.1, 7.3.2, 7.4.5, 7.5.1, 7.5.2 and 7.6.1
([docs/security/asvs/v7-session-management.yaml](asvs/v7-session-management.yaml)).

## What a session is

An opaque, random 256-bit id in the cookie `__Host-session`; the database holds only its SHA-256 (`identity_session`). Every request is
checked against the row, which also checks that the user is still active and not deleted. Nothing about a session lives in the
browser except the id. A password login and an OIDC login each make a new session and end the one the browser presented. No device
name, user agent or address is stored (see "Concurrent sessions").

## The two lifetimes (7.1.1, 7.3.1, 7.3.2)

| Limit          | Default | Setting (`core.identity`)    | Behaviour                                                                                                                                    |
| -------------- | ------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Inactivity     | 7 days  | `sessions.inactivityDays`    | The session ends this long after its last use. Using it moves the end forward, at most once a minute, but never past the absolute end.       |
| Absolute       | 30 days | `sessions.absoluteDays`      | Fixed when the session is created (`absolute_expires_at`). However often the session is used, it is over then and the person signs in again. |
| Recent sign-in | 5 min   | `sessions.recentAuthSeconds` | How recently the person must have proved who they are for the actions under "Recent authentication".                                         |

Whole days, at least 1 and at most 365; the absolute limit is never less than the inactivity period. A session keeps the ends it was
created with: changing a setting applies to sessions created afterwards, and an administrator who needs a change to apply at once ends
the sessions (below). The migration that introduced the absolute end gave every existing session `created_at + 30 days`.

**Risk analysis behind the defaults.** Scorpion is a service registry and KPI tracker for research infrastructures. It holds names,
email addresses, the services an organisation offers and their usage numbers, and the accounts of the people who curate them. It holds
no payment data and no health data, and most of what it shows is meant to be public. The attacker this limits is the one who obtains a
session cookie (a shared or stolen laptop, a leaked log, malware on a browser) rather than the credentials. Cookie theft is bounded by:

- the cookie being `Secure`, `HttpOnly`, `SameSite=Lax` and `__Host-` prefixed, and writes needing the CSRF token (ADR-0007);
- the absolute limit, which turns "valid for as long as it keeps being used" into "valid for at most 30 days";
- the inactivity limit, which ends a session that is left behind after a week;
- recent authentication before the changes that would let an attacker keep or widen access: a new email address (the way an account is
  recovered), linking another sign-in, and ending sessions (see below);
- the list and the termination of sessions, by the person and by an administrator.

An attacker with a live session can read what the person can read and edit what the person can edit for those days. That is the residual
risk, and it is accepted at this data classification. A deployment that handles more sensitive data, or whose users are administrators of
many organisations, should shorten both values; the smallest value today is one day (an hours setting is in `docs/backlog.md`).

**Deviations from NIST SP 800-63B.** A password with no second factor is authentication assurance level 1. NIST asks AAL1 services to
repeat authentication at least every 30 days and sets no inactivity rule for it, so the defaults (30 days, and 7 days of inactivity)
meet AAL1. NIST asks for much shorter periods at AAL2 and AAL3 (hours, not weeks). Scorpion deviates from that on purpose when an
operator runs an identity provider that enforces multi-factor authentication: the local session is not shortened to the provider's AAL2
periods, because the local session guards low-sensitivity data and the actions that change authentication data re-authenticate anyway.
Scorpion does not claim AAL2 or AAL3 for its own session. Deployments that need AAL2 behaviour have no setting for it yet (backlog).

## Concurrent sessions (7.1.2)

An account may have any number of sessions at the same time. There is no limit, so there is no behaviour at a limit: Scorpion never ends a
session to make room for another. Why:

- A limit lets anyone who knows a username fill the account with sessions, which ends the person's own (a denial of service), unless
  the oldest is dropped, and then the person is signed out on a device without a reason they can see.
- Creating a session costs a login (a password hash check, or a round trip to the provider) and is rate limited per address; sessions
  end by themselves after 30 days at the latest, and the hourly cleanup job removes the rows.
- The control the requirement asks for is that the person can see their sessions and end them: `GET /account/sessions` and
  `DELETE /account/sessions/{id}`, and "log out everywhere".

The list shows the id of the session, when it began, when it was last used, and which one is the one asking. It never shows a secret or
a hash. It shows no device or location, because none is stored: a label would be personal data that needs a privacy text (M5) and a
retention rule, and it is an unreliable way to recognise a session. A person who does not recognise a session ends all of them.

## Sessions and an identity provider (7.1.3, 7.6.1)

The systems involved are Scorpion (the relying party, which creates and manages its own sessions) and each OIDC provider an operator lists
in the settings (Keycloak, an institutional provider, ...). There is no other session-creating system: personal access tokens are not
sessions (ADR-0008) and are not made from one.

- **After the login the sessions are independent.** The id_token is checked once, at the callback (ADR-0011), and a Scorpion session is
  created. From then on its lifetime is Scorpion's two limits, not the provider's. Ending the session at the provider does not end the
  Scorpion session, and ending the Scorpion session does not end the provider's (no RP-initiated logout is sent).
- **No back-channel logout.** Receiving a logout token needs a public endpoint, a table that maps the provider's `sid` to our sessions,
  and a signature check of its own; it is in the backlog. Until then the coordination is: the absolute limit (a person disabled at the
  provider keeps a Scorpion session for at most `absoluteDays`), the administrators' termination (below), and rejecting an account, which
  ends its sessions.
- **Recent authentication at the provider.** When a sensitive action needs a recent authentication and the person has no password, the
  request to the provider carries `prompt=login` and `max_age=0` (a login now, not the provider's single sign-on session). The callback
  accepts it only if the id_token carries `auth_time`, `auth_time` is not older than the moment the request was made (less 60 seconds of
  clock skew), and `sub` is the person's own at that provider. A provider that ignores the request answers with an old `auth_time` or
  none; that is refused with a 401, and the person can then not change those attributes with that account until they have a password.
- **Strength is not taken from the provider.** `acr` and `amr` are not read. Whatever the provider enforced, Scorpion treats the login as
  a single factor login. That is the documented fallback of ASVS 6.8.4.
- **What a provider's session end does not do.** A person removed at the provider keeps the Scorpion session until the absolute end
  unless an administrator ends it. Operators who cannot accept that set a shorter `absoluteDays`.

## Recent authentication (7.5.1, 7.5.2)

`identity_session.authenticated_at` is set when the session is created and again by a successful re-authentication. The window is
`sessions.recentAuthSeconds`. These need an authentication within the window and answer **401 with the problem type
`reauthentication-required`** otherwise:

- changing the email address (`PATCH /account/profile` with a new `email`; a name or a bio does not need it);
- starting to link another OIDC sign-in (`POST /auth/oidc/{provider}/link`);
- ending one session from the list (`DELETE /account/sessions/{id}`) and "log out everywhere" (`POST /auth/logout-all`).

Changing the password already needs the current password. Logging out the current session, reading the list and asking for a new
confirmation mail do not need it. A personal access token is not asked: it is a credential its owner created on purpose, it has no
authentication time, and it cannot reach the session-only routes above (except "log out everywhere", which only ends sessions).

To re-authenticate: `POST /account/reauthenticate` with the current password (422 for a wrong one, 409 for an account without a
password), or `POST /account/reauthenticate/oidc/{provider}` for the provider flow described above. Both are rate limited and audited
(`identity.session.reauthenticated@1`). The check is made in the service, before anything is written or any budget spent.

## Ending sessions for others (7.4.5)

The permission `core.identity.session.manage-any` is held by Admin only. `POST /users/{id}/sessions/revoke` ends every open session of one
user; `POST /system/sessions/revoke-all` ends every open session of every user **except the caller's own**, so the administrator who does
it is not locked out (with an access token there is no session to spare). Each is one transaction with its event
(`identity.sessions.revoked@1`, `identity.sessions.revokedAll@1`, with who and how many), which `core.audit` records as a critical entry,
and the route itself is audited too. Neither route can be used by a plain User, a user without roles or a token that does not name the
scope and whose owner does not hold the permission.

## How fast an ended session stops working (7.4.1, 7.4.2)

Every request asks the database, behind a per-process cache of 5 seconds (`SESSION_CACHE_TTL_MS`).

- **In the process that did it,** logging out, "log out everywhere", ending a session from the list, an administrator's termination and
  rejecting an account empty the cache entries of the sessions they end, before and again after the write, so the session stops
  working at once. A lookup that raced with it does not cache its result.
- **In another server process** the session may still be accepted for at most the cache TTL (5 seconds). The same bound covers the
  absolute end and the inactivity end: a cached entry may serve a session for up to 5 seconds past them. With a single process, or a TTL
  of 0, it is exact. There is no cross-process invalidation message; adding one is not planned, because 5 seconds is shorter than the time
  an administrator needs to notice anything.
- **A disabled or deleted account** is refused on every uncached lookup (status and `deleted_at` are checked in the same query). The only
  paths that change them are rejecting an account (which ends its sessions) and the purge job (which deletes the rows, sessions with them).
  There is no "disable account" feature; when it comes, it must call `revokeAll` and get a test.

## Evidence

| Requirement | Evidence                                                                                                                                                                     |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.1.1       | This page, "The two lifetimes"                                                                                                                                               |
| 7.1.2       | This page, "Concurrent sessions"                                                                                                                                             |
| 7.1.3       | This page, "Sessions and an identity provider"                                                                                                                               |
| 7.3.1       | `[ASVS-7.3.1]` in `modules/core-identity/service/sessions.test.ts`, and this page                                                                                            |
| 7.3.2       | `[ASVS-7.3.2]` in `sessions.test.ts`: a session used every day dies at the absolute limit                                                                                    |
| 7.4.5       | `[ASVS-7.4.5]` in `modules/core-identity/service/session-admin.test.ts` and `apps/server/src/sessions-routes.test.ts`                                                        |
| 7.5.1       | `[ASVS-7.5.1]` in `profile.test.ts`, `oidc-reauth.test.ts` and `sessions-routes.test.ts`                                                                                     |
| 7.5.2       | `[ASVS-7.5.2]` in `session-accounts.test.ts` and `sessions-routes.test.ts`                                                                                                   |
| 7.6.1       | This page, and `[ASVS-7.6.1]` in `sessions-oidc-routes.test.ts` (with `oidc-reauth.test.ts` and the Keycloak test in `oidc-keycloak.test.ts`) for the behaviour it describes |
| 6.8.4       | `[ASVS-6.8.4]` in `oidc-reauth.test.ts` and `sessions-oidc-routes.test.ts`: a stale `auth_time` is refused                                                                   |
