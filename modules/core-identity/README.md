# core.identity

Users, the ways they sign in, sessions, personal access tokens and approval. Package
`@scorpion/core-identity`, id `core.identity`, table prefix `identity_` (set in the manifest, so the tables
are `identity_user` and not `core_identity_user`; ADR-0004).

This is the module **as M4 sprint 2 leaves it** ([M2 plan](../../docs/m2-sprint-plan.md), [M4 plan](../../docs/m4-sprint-plan.md)): local accounts,
sessions, approval, personal access tokens, OIDC sign-in, password reset, password change, email verification, the
profile and an hourly cleanup. People can register with a password or sign in through an OIDC provider, an approver can
approve or reject new accounts, a signed-in person can create tokens for scripts, link a provider and edit their
profile, a person who forgot their password gets a link by mail, and a fresh install gets its first administrator
from `scorpion create-admin` or a one-time first-run token. **Every mail goes through [core.notifications](../core-notifications/README.md)**:
this module names a template and its data and stores the mail in the transaction that does the work ([ADR-0019](../../docs/adr/0019-module-graph-and-notifications-port.md),
[ADR-0022](../../docs/adr/0022-templates-locales-and-register-without-revealing.md)).

**Authorisation is `core.authz`'s** ([ADR-0005](../../docs/adr/0005-deny-by-default-before-authz.md),
[ADR-0014](../../docs/adr/0014-authorisation-model-and-dependency-direction.md),
[ADR-0015](../../docs/adr/0015-identity-on-authz.md)). This module **depends on `core.authz`**: it contributes the
permissions of the role `user` ([Roles](#roles-and-permissions)), asks `core.authz` for the roles of the caller and for
every decision in the service layer, and owns the routes that give and take roles. A signed-in account without a
role gets 403 on everything that is not public; a freshly approved account holds the role `user` and can use the
account routes.

## Manifest

| Part         | Now                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Later                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Permissions  | `core.identity.session.manage`, `core.identity.session.manage-any`, `core.identity.me.read`, `core.identity.user.list-pending`, `core.identity.user.approve`, `core.identity.user.reject`, `core.identity.token.read`, `core.identity.token.manage`, `core.identity.token.manage-any`, `core.identity.auth-method.link`, `core.identity.password.change`, `core.identity.email.verify`, `core.identity.profile.read`, `core.identity.profile.update`, `core.identity.role.read`, `core.identity.role.assign`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | none                                                          |
| Settings     | `localAccounts` (default `true`, enforced on the server), `approvalPolicy` (default `manual`), `oidcProviders` (default none: OIDC is off; [below](#oidc-sign-in)), `sessions` (lifetimes and the recent-authentication window; [below](#sessions-the-cookie-and-csrf)), `retention` and `mailBudgets` (today's constants as defaults; [below](#settings)). Read through `ctx.settings` (stored by [core.settings](../core-settings/README.md))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | none                                                          |
| Events       | depends on `core.authz` (which emits `authz.role.assigned@1` and `authz.role.removed@1` for the changes made here), on `core.settings` (settings, secrets, and the user preference that picks the language of a mail), on `core.blob` (the avatar) and on `core.notifications` (every mail); emits `identity.admin.created@1`, `identity.user.registered@1`, `identity.user.approved@1`, `identity.user.rejected@1`, `identity.authMethod.linked@1`, `identity.token.created@1`, `identity.token.revoked@1`, `identity.token.rotated@1`, `identity.password.resetRequested@1`, `identity.password.reset@1`, `identity.password.changed@1`, `identity.email.verified@1`, `identity.profile.updated@1`, `identity.user.purged@1` through the outbox; handles `system.ready` only (issues the first-run token, below, and names the OIDC providers without a stored client secret in the log)                                                                                                  | none; `core.audit` records every one of them (see its README) |
| Registries   | declares `auth.approvalPolicy`, contributes `manual` to it; contributes the one entry to `kernel.authenticator` (session cookie, `Authorization: Bearer`, `X-API-Key`); contributes to `authz.defaultRole` the permissions of the role `user` ([below](#roles-and-permissions)); contributes its seven mail templates to `notify.template` ([below](#mail)) and `notify.recipientAddress` (how core.notifications finds a user's address for the administrator's test mail)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | none                                                          |
| Jobs         | `core.identity.cleanup`, hourly (`0 * * * *`, UTC), 2 retries, 5 minutes ([below](#cleanup-job))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | none                                                          |
| CLI commands | `scorpion create-admin --username <name> --email <address>` (password from the prompt or stdin)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | none                                                          |
| Routes       | internal API: `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `POST /auth/logout-all`, `GET /auth/me`, `GET /account/sessions`, `DELETE /account/sessions/{id}`, `POST /account/reauthenticate`, `POST /account/reauthenticate/oidc/{provider}`, `POST /users/{id}/sessions/revoke`, `POST /system/sessions/revoke-all`, `GET /users/pending`, `POST /users/{id}/approve`, `POST /users/{id}/reject`, `GET /roles`, `POST /users/{id}/roles`, `DELETE /users/{id}/roles/{role}`, `GET /tokens`, `POST /tokens`, `DELETE /tokens/{id}`, `POST /tokens/{id}/rotate`, `POST /bootstrap/first-admin`, `POST /auth/oidc/{provider}/start`, `POST /auth/oidc/{provider}/link`, `GET /auth/oidc/{provider}/callback`, `POST /auth/password-reset`, `POST /auth/password-reset/confirm`, `POST /auth/verify-email`, `POST /account/password`, `POST /account/email/verification`, `GET /account/profile`, `PATCH /account/profile`, `PUT /account/avatar`, `DELETE /account/avatar` | none                                                          |

The README changes together with the manifest.

### Routes

All are under `/api/internal`. Bodies are JSON only; anything else is refused (415 or 422), which also keeps a
cross-site HTML form from reaching them ([ADR-0007](../../docs/adr/0007-session-cookie-and-csrf.md)).

| Route                                          | Access                                       | Notes                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /auth/register`                          | public (strict rate limit)                   | `{ username, email, password, locale? }` → **202 `{ accepted: true }`** for every well-formed request, whether the address is new (an account, `pending` under the manual policy) or taken (nothing is created; the owner gets a notice mail). 403 when `localAccounts` is off, **409 only for a taken username**, 422 for bad input |
| `POST /auth/login`                             | public (strict rate limit)                   | `{ username, password }` → 200 `{ user, csrfToken }` and the cookie. 401 for an unknown user, a wrong password, a rejected or deleted account (same answer); 403 for a pending account (after the right password) or when `localAccounts` is off                                                                                     |
| `POST /auth/logout`                            | `core.identity.session.manage`               | 204, ends the caller's session, clears the cookie                                                                                                                                                                                                                                                                                    |
| `POST /auth/logout-all`                        | `core.identity.session.manage`               | `{ revoked }`, ends every session of the caller. Needs a recent authentication (401 `reauthentication-required`)                                                                                                                                                                                                                     |
| `GET /auth/me`                                 | `core.identity.me.read`                      | `{ user, roles, csrfToken }`; `roles` are the keys `core.authz` holds for the caller right now (never cached here)                                                                                                                                                                                                                   |
| `GET /account/sessions`                        | `core.identity.session.manage`, session only | list envelope of the caller's own live sessions, newest first: `{ id, createdAt, lastSeenAt, current }`. No secret, hash, device or address. 403 for a token caller                                                                                                                                                                  |
| `DELETE /account/sessions/{id}`                | `core.identity.session.manage`, session only | 204; clears the cookie when it was the session of this request. Needs a recent authentication. **404** for an unknown id and for another user's, with the same answer. 422 for an id that is not a UUID. Audited                                                                                                                     |
| `POST /account/reauthenticate`                 | `core.identity.session.manage`, session only | `{ password }` → 204, the session counts as freshly authenticated. 422 for a wrong password, 409 for an account without a password. Strict rate limit. Audited                                                                                                                                                                       |
| `POST /account/reauthenticate/oidc/{provider}` | `core.identity.session.manage`, session only | as `start`, for the caller's own session: the authorisation request carries `prompt=login` and `max_age=0`, the callback sets the session's authentication time and sends no cookie. 404 when the account has no sign-in at that provider. Strict rate limit. Audited                                                                |
| `POST /users/{id}/sessions/revoke`             | `core.identity.session.manage-any`           | `{ revoked }`: ends every open session of the user. 404 unknown user, 422 malformed id. Audited, and the event `identity.sessions.revoked@1`                                                                                                                                                                                         |
| `POST /system/sessions/revoke-all`             | `core.identity.session.manage-any`           | `{ revoked }`: ends every open session of every user **except the caller's own**. Audited, and the event `identity.sessions.revokedAll@1` with the count                                                                                                                                                                             |
| `GET /users/pending`                           | `core.identity.user.list-pending`            | list envelope, oldest first                                                                                                                                                                                                                                                                                                          |
| `POST /users/{id}/approve`                     | `core.identity.user.approve`                 | `{ role? }` (optional body; default `user`) → pending → active **and** the role, in one transaction with the event. 404 unknown account or role, 409 not pending, 403 your own account (Admin too) or a caller without `core.authz.role.assign`; on any refusal the account stays pending                                            |
| `POST /users/{id}/reject`                      | `core.identity.user.reject`                  | pending → rejected and soft-deleted (the username stays reserved). 403 your own account, 404, 409                                                                                                                                                                                                                                    |
| `GET /tokens`                                  | `core.identity.token.read`                   | the caller's live tokens, oldest first, list envelope; never a secret                                                                                                                                                                                                                                                                |
| `POST /tokens`                                 | `core.identity.token.manage`                 | `{ name, scopes, expiresAt? }` → 201 with `token` (shown once); `scopes` are permission ids, at least one, `Cache-Control: no-store`. Strict rate limit. 409 for a taken name or more than 50 tokens, 422 for bad input                                                                                                              |
| `DELETE /tokens/{id}`                          | `core.identity.token.manage`                 | 204; also when it was already revoked; 404 for an unknown id and for someone else's (`core.identity.token.manage-any` revokes any token)                                                                                                                                                                                             |
| `POST /bootstrap/first-admin`                  | public (strict rate limit)                   | `{ token, username, email, password }` → 201 `{ user }` (an active administrator; no cookie). 401 for a token that is unknown, used, expired or malformed, and for any token once an active user exists; 409 for a taken name or address and 422 for bad input, both leaving the token usable                                        |
| `POST /tokens/{id}/rotate`                     | `core.identity.token.manage`                 | `{ expiresAt? }` (send `{}`) → the new token, same name and scopes, shown once; the old one is dead. Strict rate limit. 404 as above                                                                                                                                                                                                 |

| `GET /roles` | `core.identity.role.read` | list envelope of `{ key, label, system, permissions }`, by key. Also needs `core.authz.role.read` (service). Admin lists every declared permission |
| `POST /users/{id}/roles` | `core.identity.role.assign` | `{ role }` → 200 `{ id, role, changed }` (`changed` false when held already). Also needs `core.authz.role.assign`. 404 unknown user (or deleted) or role, 403 your own roles (Admin too) |
| `DELETE /users/{id}/roles/{role}` | `core.identity.role.assign` | 204, also when the user did not hold it. 403 your own roles, 404, 409 for the last Admin |
| `POST /auth/oidc/{provider}/start` | public (strict rate limit) | no body → 200 `{ authorizationUrl }` and the `__Host-oidc-login` cookie. 404 unknown provider, 422 malformed id, 502 provider unreachable |
| `POST /auth/oidc/{provider}/link` | `core.identity.auth-method.link`, session only | as `start`, but the callback adds the identity to the caller's account. Needs a recent authentication (401 `reauthentication-required`). Strict rate limit. 401 anonymous, 403 token caller |
| `GET /auth/oidc/{provider}/callback` | public (strict rate limit) | `?state&code` (or `?state&error`) → 302 to the application root and the session cookie. 400 bad state / refused, 401 bad id_token or refused account, 403 pending, 409, 422 bad query, 502 |

The token routes are described under [Access tokens](#access-tokens), the OIDC routes under [OIDC sign-in](#oidc-sign-in). Every route has a denied-request test, and `apps/server/src/defect-01.privilege-escalation.test.ts` walks the live route
table and fails when a non-public route has no entry in its "denied for a plain User" matrix.

Registering tells a caller when a **username** is taken (409; usernames are public) and says nothing about an address
([Registering without revealing](#registering-without-revealing)). Signing in tells an account that is pending (after the
right password) to wait; signing in does not tell whether a username exists.

### Access tokens

[ADR-0008](../../docs/adr/0008-personal-access-tokens.md) has the reasoning. In short:

- **Format** `scp_<8-character prefix>_<secret>`, 56 characters; the secret is 256 random bits (base64url) and is stored
  only as an argon2id hash. `service/token-format.ts` parses it (anything else is "invalid", never an exception: defect 3).
- **Use** `Authorization: Bearer <token>` or `X-API-Key: <token>` (`Authorization` wins). The authenticator turns a good
  token into an `Actor` `{ via: 'token', scopes }`. A malformed, unknown, wrong, expired or revoked token, or one whose
  owner is not active, is a **401**, the same answer for each, and the check costs the same (a decoy hash for an unknown
  prefix). On a `public: true` route a bad token means "not signed in".
- **A request with a token is a token request:** the cookie is ignored (no CSRF check, no session privileges). A bad
  token is a 401 even with a good cookie.
- **Scopes** are permission ids ([ADR-0015](../../docs/adr/0015-identity-on-authz.md)), for example
  `core.identity.me.read`: dotted kebab case, at most 20 per token and 100 characters each. A token needs at least one
  (without scopes it could do nothing), and each must be a permission that a loaded module declares (422 otherwise,
  also for the legacy `read:kpi` shape). **What a token may do is its scopes ∩ the permissions of its owner**, decided by
  `core.authz` at every call, for the route and again in the service: a scope the owner does not hold grants nothing, and
  an owner who loses a role takes it away from the token within the cache bound below. A session is not limited by
  scopes. Scopes of tokens made in 0.3.0 had the shape `read:kpi`; they match no permission and so grant nothing (create
  a new token).
- **Managing tokens needs a session.** Create, list, revoke and rotate answer 403 to a caller who used a token, so a
  stolen token cannot mint another. Every query is scoped to the caller; someone else's token id gets the same 404 as an
  unknown one, unless the caller holds `core.identity.token.manage-any`, which revokes any token (it never lists or
  rotates someone else's: the new secret would go to the administrator). The service checks the permission again with
  `core.authz` (`token.read`, `token.manage`).
- **Cache and the staleness bound.** A verified token is trusted in memory for **5 seconds** (`TOKEN_CACHE_TTL_MS`,
  keyed by the SHA-256 of the token), because argon2id on every call is too expensive. Revoke and rotate drop the entries
  of _this_ process at once. **With several server processes another process can accept a revoked token for at most
  5 seconds.** Wrong tokens are never cached; the entry honours the token's own expiry.
- **Last use** (`last_used_at`) is written at most once a minute, off the request path; a failed write is logged and
  ignored.
- **Failed attempts** are charged to a strict bucket per client address (burst of 10, then 10 a minute) that is checked
  _before_ the token is verified: when it is empty every token request from that address gets a 429, even with a good
  token, until it refills. This is in the server's pipeline (`pipeline/authenticate.ts`), not in this module.
- **Rotating** revokes the old token and creates the new one in one transaction. A name is unique among live tokens, so
  a revoked token frees its name.

### OIDC sign-in

[ADR-0011](../../docs/adr/0011-oidc-login.md) has the reasoning (defect 5). In short:

- **Providers** are `settings.oidcProviders`, a list of `{ id, displayName, issuer, clientId, scopes }` (`id`: lower-case
  letters, digits and `-`, at most 32, not `local`; `issuer`: https, or http for localhost; `scopes` default
  `openid email profile` and must contain `openid`). The list is empty by default, which turns OIDC off. `localAccounts`
  governs the password only; **OIDC has no setting of its own and ignores `localAccounts`**.
- **Redirect URI** is fixed by the route: `<ORIGIN><BASE_PATH>/api/internal/auth/oidc/<id>/callback`. Register exactly
  that at the provider.
- **Client secret**: the encrypted secrets store of [core.settings](../core-settings/README.md), under the name
  `oidc.<provider id>.client-secret` (`life-science-aai` → `oidc.life-science-aai.client-secret`). Set it with
  `scorpion set-secret oidc.life-science-aai.client-secret` (the value is asked for or read from standard input), or
  with `PUT /secrets/{name}` as an administrator. A provider without a stored secret is a public client (PKCE only);
  the start-up log names such providers (never a secret). **There is no environment fallback: `OIDC_<ID>_CLIENT_SECRET`
  is not read** (M3 decision 4, [ADR-0016](../../docs/adr/0016-secrets-store-and-key-rotation.md)), so an instance
  that upgrades from 0.3.x must store its secrets once. One function, `service/oidc-secret.ts`, asks the store; the
  value goes to the code exchange and is in no setting, log, response, event or error.
- **Flow.** `POST …/start` creates a login state and returns the provider URL (authorisation code flow, PKCE S256,
  `state`, `nonce`); the browser goes there and the provider redirects it to `GET …/callback`. A signed-in browser may
  start a login too (switching accounts); the session it held ends when the new one begins.
- **Login state** (`identity_login_state`): provider id, SHA-256 of `state`, SHA-256 of `nonce`, expiry (10 minutes), and
  for linking the user id. The PKCE verifier is **not stored**: it is the value of the `__Host-oidc-login` cookie
  (`Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`) and the table keeps its SHA-256 (the PKCE challenge), which
  also ties the callback to the browser that started the login (login CSRF). The callback does not need the session
  cookie. The state is used up by one `DELETE … RETURNING` before anything else is checked: an unknown, expired,
  replayed or other-browser state is a 400, and two parallel callbacks give one winner.
- **id_token** (`service/oidc-token.ts`, `jose`): signature by the provider's JWKS (RS256, PS256, ES256 only; `none` and
  HMAC refused), `iss`, `aud` (and `azp`), required `exp` / `iat` / `sub`, `nbf`, a 60 s clock skew, and the `nonce`. Any
  failure is a 401 with no session and no user. Discovery and the JWKS are fetched with a 10 s timeout, a 1 MiB limit and
  no redirects, cached (1 h and 10 min; an unknown `kid` re-reads the keys once per 30 s); an unreachable or malformed
  provider is a 502. The code exchange is raced against the same 10 s.
- **First login** with an unknown `(provider, sub)` creates a user: status from the `auth.approvalPolicy` registry
  (`provider` is the provider id; the default `manual` policy leaves it `pending`, and a pending account gets a 403 and
  no session), the address stored **only when the provider sent `email_verified: true`** (the boolean), the username
  derived from `preferred_username`, else the address before `@`, else `user`: lower-cased, accents removed, anything
  else `-`, padded to 3 and cut to 31, made unique with a hash suffix of the identity (`sam`, `sam-1a2b`, …). Claims decide nothing else.
- **Linking by email**: only when the provider vouches for the address **and** the existing account's address is verified
  too. An existing account whose address nobody confirmed (a password account whose owner has not opened the mailed link) is never
  taken over: the login is a 409 telling the person to sign in the usual way and link from the profile. A rejected or
  deleted account is a plain 401, a pending one is linked and answers 403.
- **Linking from the profile**: `POST …/link` needs a session (an access token gets 403). The callback adds the identity to
  that user; an identity that belongs to anyone, or a provider the user already has, is a 409.
- **Events**: provisioning emits `identity.user.registered@1` in the transaction that creates the user and its identity;
  linking emits `identity.authMethod.linked@1 { userId, username, provider, via: 'email' | 'profile' }`. Signing in emits
  nothing. No subject, address or secret is in either.
- **Bootstrap**: OIDC provisioning never makes an administrator. "No administrator yet" means "no user holds the Admin
  role", so an OIDC account, pending or active, does not end the first-run bootstrap. An approval policy that
  activates OIDC accounts at once gives them the role `user` in the transaction that creates them; a pending one gets
  its role with the approval.
- **Trust.** The provider's `email_verified` is believed for linking, so list only providers that verify addresses.
- **Not yet:** a public list of providers for the login page (M5), cleanup of expired login states (sprint 5's hourly job).

### Password reset, password change and email verification

Design and reasons: [ADR-0012](../../docs/adr/0012-mail-tokens-and-mail-ordering.md).

| Route                               | Access                                        | Notes                                                                                                                                                                                                                                                  |
| ----------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /auth/password-reset`         | public (strict rate limit)                    | `{ email }` → **202** `{ accepted: true }` for every address, known or not, eligible or not. 403 when `localAccounts` is off, 422 for a malformed address                                                                                              |
| `POST /auth/password-reset/confirm` | public (strict rate limit)                    | `{ token, password }` → 204. **400** for a token that is unknown, malformed, used, expired or of the other kind (one answer), 422 for a weak password (the link stays usable), 403 when `localAccounts` is off                                         |
| `POST /auth/verify-email`           | public (strict rate limit)                    | `{ token }` → 204 and the address is confirmed. 400 as above. Not gated by `localAccounts`: an OIDC-only user has an address too                                                                                                                       |
| `POST /account/password`            | `core.identity.password.change`, session only | `{ currentPassword, newPassword }` → 204 and the cookie is cleared. 422 for a wrong current password or a weak new one, 409 for an account without a password, 403 for a token caller or when `localAccounts` is off, 401 anonymous. Strict rate limit |
| `POST /account/email/verification`  | `core.identity.email.verify`, session only    | no body → 202. A fresh link for the caller's own address (or the new one that waits for confirmation). 409 when it is already confirmed, 429 after five in an hour. Strict rate limit                                                                  |

- **What a reset needs.** An address that belongs to an `active`, not deleted account with a password. An OIDC-only,
  pending, rejected or deleted account, and an unknown address, get nothing, and the answer is the same 202.
  `localAccounts` gates reset and change (they are password features, like register and login); verification is not
  gated.
- **Tokens.** `srt_` (reset, valid 1 hour) or `sev_` (verification, valid 24 hours) and 256 random bits. Only the
  SHA-256 hash is stored (`identity_mail_token`). Single use (one atomic update), and a new token for the same user and
  purpose ends the older one. The token is in the mail only: not in a response, an event, an error or a log line.
- **The mail.** A template of core.notifications (`identity.password-reset`, `identity.email-verification`; both
  `sensitive` and `mandatory`), queued **in the transaction that stores the token and the event**, so a rollback sends nothing
  and the request never waits for a relay: it only inserts a row, whether or not the address exists. The rendered body is
  deleted from the queue row once the mail is sent (or has failed for the last time); a test greps the log, every table and the
  responses for the token. Each address is mailed 3 times an hour (the budget is spent for unknown addresses too).
- **The link** is `<ORIGIN><BASE_PATH>/reset-password#token=…` or `…/verify-email#token=…`. The token is in the
  fragment, so no server or proxy log sees it. The pages arrive with the UI (M5); they read the fragment and post it
  to the confirm route. The other pages the mails link to are `/login`, `/forgot-password` and `/admin/users/pending`
  (`service/mail-links.ts`), also built by M5.
- **Sessions and access tokens.** A reset or a password change ends **every session** of the user, the caller's
  included, and every outstanding reset link. Access tokens (PATs) are **not** touched: they are separate credentials
  with their own revocation, the plan says "sessions", and revoking them would silently break scripts. The owner can
  revoke them from the token list.
- **Verification and OIDC.** A password account is unverified until its owner opens the mailed link; registering
  sends it. **From now on a verified password account can be linked by an OIDC login with the same address**
  ([OIDC sign-in](#oidc-sign-in): linking needs a verified address on the account and a provider that vouches for
  it). Before the confirmation it still answers 409.
- **Mail setup.** None in this module. The relay (host, port, TLS mode, user) is a setting of core.notifications and its password a
  secret (`scorpion set-secret notifications.smtp.password`); `SMTP_URL` is gone, without a fallback. The sender, the instance
  name, the logo, the contact address and the imprint link in a mail come from the branding settings of core.settings. The
  mail budgets are settings of this module ([Settings](#settings)).
- **The residual risk** is a guess campaign spread over many client addresses against one username. The per-address
  bucket does not cap that. It is accepted for M2 (the strict bucket and the cost of argon2 make it slow) and recorded in `docs/backlog.md` with the options that avoid the DoS: alerting on
  failures per username, a proof-of-work or CAPTCHA step-up after repeated failures, and 2FA.

### Registering without revealing

`POST /auth/register` answers **202 `{ accepted: true }`** for every well-formed request (M4 decision 4; the route used to answer 201 with
the new account, and 409 for a taken address). A new address gets the account, the welcome mail and the confirmation link; an address that
already has an account gets **only** the mail `identity.register-attempt` ("someone tried to register with your address", `mandatory`, no
link with a token) and nothing is created. A taken **username** stays a 409: usernames are public, and the check comes first, so a taken
username with a taken address is the same 409. The details:

- **Equal work.** The address's mail budget is spent on both paths before anything tells them apart, and the password is hashed on both. The
  taken path then writes one row, the new path a few more; the difference is a few inserts next to an argon2 hash. A rejected
  (soft-deleted) account's owner is not mailed (the person was refused; "you have an account" would mislead), the response is the same.
- **When the budget is spent** the new person gets no welcome or confirmation mail (the administrators are still told), and the owner of a
  taken address gets no notice; the answer is the same 202.
- **Mails of a registration** (one transaction with the account and its event; the mails are queued before the event, so a failing outbox
  rolls them back): `identity.welcome` and `identity.email-verification` to the person, and, when the account waits for review,
  `identity.registration-request` to every administrator (holders of the Admin role, resolved by `core.authz.listHoldersAsSystem`, active, with
  an address, each in their own language). A policy that activates the account at once sends no administrator mail and the welcome mail
  shows a sign-in link.
- **Language.** An optional `locale` in the body of `POST /auth/register` and `POST /auth/password-reset` (a tag like `de` or `pt-BR`;
  422 for a malformed one) chooses the language of the mails sent before the account has a preference; a well-formed tag that is not shipped
  falls back to the instance default. Mails to a signed-in person or an administrator use their preference `notifications.locale`.
- **No UI yet.** M5 builds the "check your mail" page for everybody; until then a client reads the 202 as "accepted".

## Mail

Seven templates of the registry `notify.template` (`service/mail-templates.ts`), each in English and German, built on the shared layout of
core.notifications:

| Template                        | To                             | When                                            | Flags                     |
| ------------------------------- | ------------------------------ | ----------------------------------------------- | ------------------------- |
| `identity.welcome`              | the person who registered      | register (pending review, or active at once)    | category `account`        |
| `identity.registration-request` | every active administrator     | register, when the account waits for review     | category `administration` |
| `identity.approved`             | the person                     | approval (with a sign-in link)                  | category `account`        |
| `identity.rejected`             | the person                     | rejection (with the instance's contact address) | category `account`        |
| `identity.password-reset`       | the account behind the address | reset request                                   | `sensitive`, `mandatory`  |
| `identity.email-verification`   | the address to confirm         | register, address change, resend                | `sensitive`, `mandatory`  |
| `identity.register-attempt`     | the owner of a taken address   | register with a taken address                   | `mandatory`               |

An account with no address gets no mail. Every mail is queued inside the transaction of the work (register, approve, reject, reset request,
verification request, address change), with a rollback test for each. Adding a template: contribute an entry built with `defineTemplate`
(schema, both catalogues) and add it to `IDENTITY_TEMPLATES`; the template test fails without German messages for every key.

### Bootstrap: `create-admin` and the first-run token

[ADR-0010](../../docs/adr/0010-first-run-token-and-bootstrap-admin.md) and [ADR-0009](../../docs/adr/0009-module-cli-commands.md)
have the reasoning. The "first registrant becomes admin" rule is gone (defect 1).

- **`scorpion create-admin --username <name> --email <address>`** creates an _active_ local account and gives it
  the Admin role (by the system: `assigned_by` is null). The password is read from the terminal prompt (no echo) or, without a terminal, as the first line of
  standard input: `printf '%s\n' "$PW" | scorpion create-admin …`. It is **never** taken from an argument:
  `--password` is refused, and the password appears in no output and no log. Exit codes: 0 created, 1 refused (invalid
  input, taken name or address; the message names fields, never values), 2 wrong usage. The command can be run again to
  add another administrator. It is contributed by this module (`commands`), so a profile without it has no such command.
- **The first-run token.** When the server (or worker) starts and **no user holds the Admin role** and there is no
  first-run token that is still good, it issues one and shows it _once_ as a plain-text block on **standard error**: `sfr_` and 43
  characters, valid for 1 hour, single use. It is the one secret printed anywhere: it does not go through the structured
  logger, and nothing repeats it (not a later line, a response, an event or the database, which keeps only its SHA-256).
  Use it with `POST /api/internal/bootstrap/first-admin` (below `BASE_PATH`) and the body `{ token, username, email,
password }`. A failed attempt that is the caller's mistake (taken name, weak password) does not use the token up.
- A restart while the token is still good cannot show it again; the log says that one is outstanding (without the
  secret). Wait for it to expire, or run `create-admin`. `create-admin` also ends any outstanding token.
- "No administrator yet" means "no user holds the Admin role" (`hasHolders('admin')` of the authz service). A
  deactivated administrator still counts until the purge removes their assignment. Other users, active or not, do not end
  the bootstrap path.
- Under `NODE_ENV=test` the default shows nothing; a test passes `announce` to receive the text.
- **Events.** Both paths emit `identity.admin.created@1 { userId, username, origin: 'cli' | 'first-run' }` in the
  same transaction as the account, the Admin role (`authz.role.assigned@1`, actor `null`) and the end of the tokens. No
  password or token is in it.

### Events

CLAUDE.md rule 6: a write that touches more than one row emits its domain event through the outbox **in the same
transaction** (a failing outbox rolls the write back; each service has a test for it). An event says who did what; **no
event holds a password, a hash, a token, a link or an email address**, and a profile event lists field names, never values.
Mail does not ride the events (a token cannot travel in one, ADR-0019). `core.audit` records them (ADR-0021): the actor is `approvedBy`, `rejectedBy`, `revokedBy` or the user, and the stored payload leaves out `username`.

| Event                                   | Payload                                              | Emitted by                                                         |
| --------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------ |
| `identity.user.registered@1`            | `{ userId, username, status }`                       | register, OIDC provisioning                                        |
| `identity.user.approved@1`              | `{ userId, username, approvedBy }`                   | approve                                                            |
| `identity.user.rejected@1`              | `{ userId, username, rejectedBy }`                   | reject                                                             |
| `identity.admin.created@1`              | `{ userId, username, origin: 'cli' \| 'first-run' }` | `create-admin`, the first-run token                                |
| `identity.authMethod.linked@1`          | `{ userId, username, provider, via }`                | OIDC link (`via` is `email` or `profile`)                          |
| `identity.token.created@1` `.revoked@1` | `{ userId, tokenId, name }`                          | access token create, revoke                                        |
| `identity.token.rotated@1`              | `{ userId, tokenId, name, previousTokenId }`         | access token rotate                                                |
| `identity.password.resetRequested@1`    | `{ userId, username }`                               | a reset link was issued (only for an account that can use it)      |
| `identity.password.reset@1`             | `{ userId, username }`                               | a password was set with a reset link                               |
| `identity.password.changed@1`           | `{ userId, username }`                               | the caller changed their own password                              |
| `identity.email.verified@1`             | `{ userId, username }`                               | an address was confirmed from its mail                             |
| `identity.session.reauthenticated@1`    | `{ userId, username, method: 'password' \| 'oidc' }` | a session was re-authenticated (never a credential)                |
| `identity.sessions.revoked@1`           | `{ userId, username, revokedBy, count }`             | an administrator ended every session of one user                   |
| `identity.sessions.revokedAll@1`        | `{ revokedBy, count }`                               | an administrator ended every session of everybody but their own    |
| `identity.profile.updated@1`            | `{ userId, username, fields }`                       | profile edit; `fields` ⊆ `displayName`, `bio`, `email` (asked for) |
| `identity.user.purged@1`                | `{ userId, username }`                               | the cleanup job, just before the account row is deleted            |

The purge also removes the account's role assignments (`core.authz`), releases the avatar (`core.blob`) and deletes the account's in-app inbox
(`removeInboxOfUser` of `core.notifications`), all in the purge transaction ([ADR-0023](../../docs/adr/0023-inbox-preferences-and-delivery-administration.md)).

Routes with `audit` (the pipeline writes an entry for each call, denied ones too): approve, reject, assigning and removing a role, and creating, revoking and rotating a token. The authenticator now sets `tokenId` on the `UserActor` of a token call, for the trail. Not emitted on purpose: login, logout and the verification mail being sent (high volume or no state change; the audit
module, later, records those from requests). The module handles only `system.ready`.

### Settings

The manifest declares these keys (`service/settings.ts`). The module reads them through `ctx.settings`
([ADR-0017](../../docs/adr/0017-settings-port.md)): the values an administrator saved with
`PUT /settings/core.identity` (see [core.settings](../core-settings/README.md)), validated by this schema, with its
defaults. A stored key that the schema rejects falls back to its default and is logged by name. Without core.settings the
defaults would apply, but this module depends on it. The internal port `IdentitySettings` stays so that tests can inject
values.

| Key                          | Default                    | Meaning                                                                                                                                                                                                                                    |
| ---------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `localAccounts`              | `true`                     | Whether people may register and sign in with a password. Enforced on the server (defect 13): register, login, reset and password change answer 403 when it is off. Existing sessions, logout, OIDC and email verification are not affected |
| `approvalPolicy`             | `manual`                   | The id of the `auth.approvalPolicy` entry that decides the status of a new account                                                                                                                                                         |
| `oidcProviders`              | none                       | The OIDC providers ([OIDC sign-in](#oidc-sign-in)); none means OIDC is off                                                                                                                                                                 |
| `sessions.inactivityDays`    | `7`                        | A session ends this long after its last use (1 to 365). Applies to sessions created afterwards                                                                                                                                             |
| `sessions.absoluteDays`      | `30`                       | A session ends this long after it began, however often it is used (1 to 365, never less than `inactivityDays`). Sessions created before the setting changed keep their end                                                                 |
| `sessions.recentAuthSeconds` | `300`                      | How recently the caller must have signed in or re-authenticated for an email change, linking a provider, ending a session or "log out everywhere" (30 to 3600)                                                                             |
| `retention.purgeAfterDays`   | `30`                       | How long a soft-deleted account keeps its username and address before the cleanup purges it (1 to 3650)                                                                                                                                    |
| `retention.tokenGraceDays`   | `30`                       | How long an expired or revoked access token is shown to its owner before it is removed (1 to 3650)                                                                                                                                         |
| `retention.purgeBatch`       | `500`                      | At most this many accounts are purged per hourly run (1 to 10000)                                                                                                                                                                          |
| `mailBudgets.perAddress`     | `{ burst: 3, perHour: 3 }` | Mails (reset and confirmation links) that one address can be sent: a burst, then a rate per hour. It protects the owner of an address                                                                                                      |
| `mailBudgets.perUser`        | `{ burst: 5, perHour: 5 }` | Confirmation mails a signed-in user can ask for, and address changes they can make                                                                                                                                                         |

The rate limit of the server's pipeline (the `default` and `strict` buckets) is not identity's: it is the `rateLimits`
setting of core.settings.

**Environment variables** (not settings, because they are secrets or deployment facts): the kernel's `ORIGIN`, `BASE_PATH` and
`TRUSTED_PROXIES`. `OIDC_<ID>_CLIENT_SECRET` is gone: client secrets are in the secrets store. The mail transport is not here any more
(core.notifications settings and secret). `SECRETS_KEY` belongs to core.settings, which this module depends on, so every
profile with core.identity needs it.

### Approval policies (`auth.approvalPolicy`)

The registry entry is `{ id, description?, decide(registration) }`; `decide` receives
`{ username, email, emailVerified, provider }` and returns `{ status: 'pending' | 'active' }`. The `approvalPolicy`
setting names the entry in force. `manual` (contributed here) returns `pending` for everyone. A policy decides from the
registration context, so `auto-by-email-domain` and `invite-only` (`docs/backlog.md`) are contributions from other
modules that depend on `core.identity`, and need no change here; a test contributes one from a second module. If the
configured policy is not installed the account stays `pending` and a warning is logged, so a typo never approves anyone.
Approving flips the status and gives the role in the same transaction ([Roles](#roles-and-permissions)).

## Tables

| Table                      | Holds                                                                                                                                                                                                                                     |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `identity_user`            | The person: unique `username`, `email` (a verified address is unique, case-insensitively), `display_name`, `bio` (plain text, length-checked), `status`, soft delete, `avatar_blob_id` (nullable; a file of core.blob, [Avatar](#avatar)) |
| `identity_auth_method`     | One way to sign in: `(provider, subject)` unique; at most one `local` (password) method per user; the argon2id hash for `local`                                                                                                           |
| `identity_mail_token`      | A mailed single-use token: `purpose` (`password-reset` or `email-verification`), the SHA-256 hash, the address a verification confirms, `expires_at`, `used_at`                                                                           |
| `identity_session`         | A browser session: SHA-256 of the 256-bit session id, `expires_at` (slides) and `absolute_expires_at` (fixed), `authenticated_at`, `revoked_at`                                                                                           |
| `identity_login_state`     | An OIDC login in progress: provider id, hashes of `state`, `nonce` and the PKCE challenge, its `purpose` (`login`, `link`, `reauth`), the user id and (for `reauth`) the session id, expiry (10 minutes, single use)                      |
| `identity_first_run_token` | The one-time token a fresh install prints: SHA-256 `secret_hash`, `expires_at`, `redeemed_at` (single use)                                                                                                                                |
| `identity_token`           | A personal access token: unique 8-character `prefix`, argon2id `secret_hash`, scopes, expiry, last use; name unique per user                                                                                                              |

Keys are UUIDv7 (`ids.uuidv7()` from the kernel). No secret is stored in the clear: sessions and login
states are SHA-256 hashes of random 256-bit values, passwords and token secrets are argon2id hashes.

### The bootstrap marker is gone

M2 marked the administrator that `create-admin` or the first-run token created with a column `is_bootstrap_admin`,
because roles did not exist yet (ADR-0006). Migration `0006_bootstrap_admin_to_authz.sql` copies every marked user into
`authz_role_assignment` with the Admin role (`assigned_by` null) and drops the column, in one transaction. It creates
the Admin role row itself when `core.authz` has not seeded it yet (same key, `ON CONFLICT DO NOTHING`, so the seed
stays idempotent), and changes nothing when no user was marked. **It is the one place in the repository that touches
another module's tables** (CLAUDE.md rule 3; the exception is recorded in ADR-0014). `bootstrap-migration.test.ts`
proves the data cases (none, one, several marked users), that the migration is atomic, that the column is gone, that no
source file outside the migrations mentions it, and that no other migration or source file names a table of another
module.

## Roles and permissions

Roles are data owned by `core.authz` ([ADR-0014](../../docs/adr/0014-authorisation-model-and-dependency-direction.md),
[ADR-0015](../../docs/adr/0015-identity-on-authz.md)). This module does three things with them.

- **The role `user`.** Identity contributes to `authz.defaultRole` the permissions an approved account needs for its own
  account: `me.read`, `session.manage`, `profile.read`, `profile.update`, `avatar.update`, `password.change`, `email.verify`,
  `auth-method.link`, `token.read` and `token.manage` (`USER_PERMISSIONS` in `module.ts`, pinned by a test). They are
  applied once, so an administrator who removes one from `user` does not see it come back. **Admin** holds every
  permission by resolution. **Reviewer gets nothing from identity**: reviewing is the job of the modules that have
  something to review. The administrative permissions (`user.approve`, `user.reject`, `user.list-pending`,
  `role.read`, `role.assign`, `token.manage-any`) belong to Admin only until an administrator gives them to a role.
- **Approval gives the role.** `POST /users/{id}/approve` takes `{ role? }` (default `user`). The status change, the
  role assignment (`authz.role.assigned@1`) and `identity.user.approved@1` are one transaction: if the role cannot be
  given (it does not exist, or the approver lacks `core.authz.role.assign`) the account stays pending. An account that an
  approval policy makes active at once (registration, first OIDC sign-in) gets `user` in the transaction that creates it.
- **Role routes.** `GET /roles`, `POST /users/{id}/roles` and `DELETE /users/{id}/roles/{role}`. **Two permissions guard
  a role change on purpose**: the route and the service check this module's `core.identity.role.read` / `.assign` (who
  may administer users here), and `core.authz` checks `core.authz.role.read` / `.assign` again inside its own methods
  (who may change roles at all, for every caller including jobs and other modules). Admin holds both pairs; a custom
  role needs both. The built-in protections of `core.authz` hold for Admin too: nobody changes their own roles (403) and
  the last Admin stays (409).

Every service of this module that acts for a caller checks its permission with `core.authz` again (the route checks it
first): approve, reject and the pending list, the token methods, the profile, password, e-mail and OIDC-link methods, `me`
and the logouts. Those that act on "the caller's own account" take no user id: the row is the caller's from the actor, so
another account cannot even be named (there is no 404 to leak). A caller without the permission gets 403.

## Scopes

A token scope is the id of a permission. The authoriser of `core.authz` allows a token only a permission that its scopes
name **and** its owner holds (scope ∩ owner), for the route and for `require`/`can` in a service; a token without scopes
can do nothing. Tokens still cannot manage tokens, and the routes that are session-only (profile, password, e-mail,
OIDC link) answer 403 to a token whatever its scopes. A token can end the sessions of its owner (`POST /auth/logout-all`)
only when a scope names `core.identity.session.manage`; that is the M2 behaviour, now limited by scope.

## Sessions, the cookie and CSRF

[ADR-0007](../../docs/adr/0007-session-cookie-and-csrf.md) and [ADR-0025](../../docs/adr/0025-absolute-session-lifetime-and-recent-authentication.md)
have the reasoning, and [docs/security/sessions.md](../../docs/security/sessions.md) is the policy (lifetimes with their risk analysis, concurrent
sessions, the provider's session, recent authentication). In short:

- The session id is 256 random bits (43 base64url characters). Only its SHA-256 is stored. A session has **two ends**: it
  ends `sessions.inactivityDays` (7) after its last use (sliding; the database is written at most once a minute per session,
  and the cookie is then sent again), and `sessions.absoluteDays` (30) after it began whatever the use. The slide never goes
  past the absolute end. A session keeps the ends it was created with.
- **Recent authentication.** `authenticated_at` is when the person last proved who they are in the session (login or a
  re-authentication). An email change (a new `email` in `PATCH /account/profile`), starting to link a provider, ending a session
  and "log out everywhere" need it within `sessions.recentAuthSeconds` (300): without it the answer is **401 with the problem
  type `reauthentication-required`**. Re-authenticate with the password (`POST /account/reauthenticate`) or, for an account
  without a password, at the provider (`POST /account/reauthenticate/oidc/{provider}`: `prompt=login`, `max_age=0`, and the
  callback requires an `auth_time` that is not older than the request, and the caller's own `sub`). A personal access token is not
  asked. Other modules ask with `ctx.deps['core.identity'].requireRecentAuth(actor)`, in their service before the work.
- **Sessions of others.** The user lists and ends their own; `core.identity.session.manage-any` (Admin) ends the sessions of one
  user or of everybody but the caller (`POST /users/{id}/sessions/revoke`, `POST /system/sessions/revoke-all`).
- Cookie `__Host-session`: `Secure; HttpOnly; SameSite=Lax; Path=/`, no `Domain`.
- The authenticator (`authenticator.ts`, the entry in `kernel.authenticator`) reads only headers. No cookie: the
  caller is anonymous. A cookie the session service refuses: `Unauthorized`. A good cookie: `Actor`
  `{ kind: 'user', via: 'session', sessionId, roles: [] }` (`sessionId` is the id of the row, not the cookie value); the authenticator never fills `roles`, `core.authz` resolves the roles of `userId` itself and this module never caches them. A session also ends when
  its user is no longer `active` or is soft-deleted.
- **CSRF.** A request with the session cookie and a method other than GET, HEAD or OPTIONS must send
  `X-CSRF-Token`, the session's token (a hash of the session id under its own label; the login and `me`
  responses return it). Otherwise it is a 401.
- **Cache and the staleness bound.** The session service keeps verified sessions in memory for **5 seconds**
  (`SESSION_CACHE_TTL_MS`). Logout, "log out everywhere", ending one session from the list and the administrators' termination
  revoke in the database and drop the entries of _this_ process at once. **With several server processes another process can accept a revoked session for at most
  5 seconds**, the time its cache entry lives. Tests set the TTL to 0 for strict behaviour. Unknown ids are never
  cached.

## Public API (`public.ts`)

`ctx.deps['core.identity']` offers `requireRecentAuth(actor, maxAgeSeconds?)` (see [Sessions](#sessions-the-cookie-and-csrf)) and `users`:

- `createUser(input)`: validates (422 `Invalid`), refuses a taken username, a taken email address (verified or not,
  whatever way its holder signs in, case-insensitive) or an identity that is already linked (409 `Conflict`), then
  writes the user and its auth method in one transaction. A race is stopped by the unique indexes and is also a 409.
  The result never holds a hash or an internal flag.
- `findById(id)`: `undefined` when there is no such user, also for text that is not a UUID.
- `findByUsername(name)` and `findByEmail(address)`: case-insensitive, `undefined` when there is no match,
  soft-deleted users included (the caller refuses their login).

The register, login, session and approval services are internal to the module; the routes call them through
`r.service()`. Other modules read users and ask `core.authz` about permissions.

## Rules for input (`validation.ts`)

Username 3 to 31 of `a-z 0-9 _ -`; password 8 to 255 characters; email in address format, at most 254 characters;
provider id lower-case letters, digits and `-`; subject 1 to 255 characters. The service applies them to every
caller, so the routes, the CLI and OIDC provisioning cannot skip one.

## Passwords (`service/password.ts`)

argon2id through `@node-rs/argon2`: 64 MiB, 3 passes, 1 lane, 32-byte output (RFC 9106, lanes reduced to one).
The parameters are in one place; a unit test pins them. Under `NODE_ENV=test` only, cheap parameters are used.
`verifyPassword` returns `false` for a hash it cannot parse; it never throws.

## Testing

`pnpm test --filter @scorpion/core-identity` needs Docker (Testcontainers). Use the factories `makeUser`,
`makeAuthMethod`, `makeSession`, `makeToken`, `makeRole` and `makeRoleAssignment` from `@scorpion/testing`. The harness
`test/harness.ts` starts the real `core.authz` next to this module, so permissions are decided by roles in the database,
never by a stand-in: `makeMember(pool)` makes a user who holds the role `user` (as an approved account does) and
`actorOf(user, ...roles)` an actor whose roles are rows. `testAuthorizer()` is only for tests of the pipeline itself.

The routes are tested through the whole pipeline, on real Postgres, in `apps/server/src` (a module cannot import the
server; `cli.test.ts` runs the real `scorpion create-admin` and `scorpion start` as processes): `identity-routes.test.ts`, `defect-04.logout-revokes.test.ts` and `defect-13.local-accounts.test.ts`, `defect-03.invalid-token.test.ts`, `tokens-routes.test.ts`, `bootstrap-routes.test.ts`, `oidc-routes.test.ts`, `defect-05.oidc-validation.test.ts`, `recovery-routes.test.ts`, `profile-routes.test.ts`, `defect-01.privilege-escalation.test.ts` (defect 1, with the route-table walker) and `identity-journey.test.ts` (the whole story from registration to a dead cookie, with the log checked for secrets at the end), with
`useIdentityApp()` from `src/testing/identity-app.ts`. The OIDC tests talk to `startStubIdp()` from `@scorpion/testing`, a
provider on a local port (discovery, authorisation, a token endpoint that checks PKCE and the secret, a JWKS) whose
`faults` break the id_token one way at a time; `oidc-keycloak.test.ts` runs the same flow against a Keycloak container. A test builds its own manifest with
`createIdentityModule({ settings, sessionCacheTtlMs, tokenCacheTtlMs })` to change a setting or a cache TTL. core.notifications is real in these tests and no worker runs, so a mail stays `queued` with its body: `mail.all()` (from `@scorpion/testing`) reads what was queued, `test/mail.ts` reads a token from a link and breaks the outbox on purpose (the rollback tests), and `notifications.deliverDue()` sends through a test relay when a test needs the sender or the scrubbed row. `mail.test.ts` covers who is mailed when, in which language and with a rollback case for each flow; `mail-templates.test.ts` the seven templates.
