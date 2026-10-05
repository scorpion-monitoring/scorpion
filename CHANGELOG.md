# Changelog

## 0.4.0

### Minor Changes

- d0475ff: Add the `core.authz` module to the `full` and `kpi-tracker` profiles. It stores roles as data (Admin, Reviewer
  and User are created at start-up) and replaces the deny-everything default for routes that need a permission. Admin
  holds every permission that a loaded module declares; other roles hold the permissions stored for them, and a stored
  permission that no loaded module declares is logged and never granted. Nobody can change their own roles, approve their own
  request or remove the last Admin. A new migration creates the `authz_` tables; there is nothing to configure.

  What you will notice: a signed-in user still gets 403 on every route that is not public, because `core.identity`
  does not assign roles yet (the next release does), and a request without credentials to such a route now gets 401
  instead of 403. Role changes reach other server processes within 5 seconds. Modules can read the permissions that the
  loaded manifests declare as `ctx.permissions`.

- 4a8957c: Roles now work. Approving an account gives it a role, and a signed-in person can use their own account: this is the first
  release in which a person who registered can do anything.

  - **First administrator.** `scorpion create-admin` and the first-run token now give the new account the Admin role
    (recorded as given by the system). The first-run token is shown at start-up while nobody holds the Admin role, instead
    of while no user is active.
  - **Approving.** `POST /api/internal/users/{id}/approve` takes an optional `{ "role": "reviewer" }` (default `user`); the
    account and its role change together, or not at all. The approver needs `core.authz.role.assign` as well as
    `core.identity.user.approve`. Nobody, Admin included, can approve or reject their own account.
  - **Roles.** New routes `GET /roles`, `POST /users/{id}/roles` and `DELETE /users/{id}/roles/{role}`, and
    `GET /auth/me` returns the real roles. New permissions: `core.identity.role.read`, `core.identity.role.assign` (a role
    change needs these and the matching `core.authz.role.*`) and `core.identity.token.manage-any`. The role `user` holds the
    self-service permissions; Reviewer holds none from this module; Admin holds everything.
  - **Access tokens are limited to their scopes.** A scope is now a permission id such as `core.identity.me.read`, and a token
    can do only what its scopes name and its owner holds. A new token needs at least one scope. The `read:kpi`-shaped
    scopes of 0.3.0 grant nothing: create a new token. Role changes reach other server processes within 5 seconds.
  - **Database.** Migration `0006` copies every user marked as administrator in 0.3.0 into an Admin role assignment and drops
    the column `identity_user.is_bootstrap_admin`. An existing 0.3.0 database keeps its administrators and needs no manual
    step; a database with no marked user changes nothing. Purging a rejected account now also removes its role assignments.
    Two events are new (`authz.role.assigned@1`, `authz.role.removed@1`), `identity.user.approved@1` gains `role` and
    `identity.token.revoked@1` gains `revokedBy`.
  - **Defect 1.** The privilege-escalation regression suite is in place, including a check that fails when a route has no
    decision in its "denied for a plain User" table.

- 671ffbb: Settings, preferences and secrets are stored by the application instead of fixed in code or the environment. **This release
  needs a new environment variable, `SECRETS_KEY`, and stops reading `OIDC_<ID>_CLIENT_SECRET`.**

  - **`SECRETS_KEY` is required** by every profile that includes `core.settings` (`full` and `kpi-tracker`, and every profile
    with `core.identity`). It is 32 random bytes, base64 encoded: generate one with `openssl rand -base64 32`. Without a valid
    one `scorpion start`, `scorpion worker` and every module command stop with `Cannot start core.settings:` and say how to
    make one; `scorpion migrate` does not need it. Keep it with your backups of the database: without it the stored secrets
    cannot be read (set them again). `pnpm dev` generates one into `.env`; the image smoke test and `docker-compose.dev.yml`
    pass it through.
  - **OIDC client secrets move to an encrypted store.** `OIDC_<ID>_CLIENT_SECRET` is no longer read, with no fallback. After
    upgrading, store each secret once: `scorpion set-secret oidc.<provider id>.client-secret` (the value is asked for or read
    from standard input, never taken from an argument). Until then a provider is a public client (PKCE only), which most
    providers refuse for a confidential client, and the start-up log names the providers that have no stored secret. Values
    are AES-256-GCM encrypted, write-only through the API, and in no log, event, error or response.
  - **New commands.** `scorpion set-secret <name>` and `scorpion rotate-secrets [--batch-size <n>]`. To change the key: set
    `SECRETS_KEY_NEXT` to the new key everywhere and restart, run `scorpion rotate-secrets` (resumable; each row is verified
    before its batch commits), then set `SECRETS_KEY` to the new key, remove `SECRETS_KEY_NEXT` and restart. Steps in the
    README of `core.settings`.
  - **New routes** (internal API). `GET /settings`, `GET /settings/{module}`, `GET /settings/{module}/schema` (JSON Schema for
    the admin form) and `PUT /settings/{module}` (validated by the module's own schema, `422` with the failing fields, `409`
    when the version is stale); `GET /secrets`, `PUT /secrets/{name}` and `DELETE /secrets/{name}` (names only, never a
    value); `GET /preferences`, `PUT /preferences/{key}` and `DELETE /preferences/{key}` (your own, for keys that modules
    register).
  - **New permissions.** `core.settings.read`, `core.settings.write` and `core.settings.secret.write` belong to Admin only.
    `core.settings.preference.read` and `.write` are held by the role `user` (and Admin). New events:
    `settings.changed@1` (module and the names of the changed keys), `settings.secret.changed@1` and
    `settings.preference.changed@1`; none carries a value.
  - **Settings take effect without a restart.** A change is seen at once by the process that saved it and by the other server
    processes within 5 seconds. Turning off `localAccounts` through `PUT /settings/core.identity` now makes register and
    login answer `403` everywhere within that time. The numbers that were fixed in code are now settings with the same
    values as defaults: the server's rate limits (`core.settings`: `rateLimits`), the retention of the cleanup job and the
    mail budgets (`core.identity`: `retention`, `mailBudgets`).
  - **Database.** One new migration in the new module `core.settings` adds the tables `settings_setting`,
    `settings_user_preference` and `settings_secret`. An existing 0.3.x database loses nothing and needs no manual step
    except the two above (`SECRETS_KEY`, the OIDC secrets).

- 1376b35: Vocabularies, a file store and branding settings complete the configuration of an instance, and a signed-in person can
  upload an avatar. **`kpi-tracker` and `full` now include the new module `core.blob`, which brings `sharp` (a native library
  with prebuilt binaries per platform) and DOMPurify to their images; an image runs on the CPU architecture it was built for.**
  No new environment variable.

  - **Vocabularies replace enums.** Stages (`DEV`, `DEMO`, `PROD`, `TERM`), thematic categories, necessity levels, sender types
    and aggregate functions are terms an administrator can relabel, reorder, deactivate and extend, and modules declare their
    own in the registry `vocabulary`. New routes (internal API): `GET /vocabularies`, `GET /vocabularies/{vocabulary}/terms`,
    `POST /vocabularies/{vocabulary}/terms`, `PATCH` and `DELETE /vocabularies/{vocabulary}/terms/{key}`. A term a module
    declared, or one that is in use, is deactivated instead of deleted. New permissions: `core.settings.vocabulary.read`
    (role `user`) and `core.settings.vocabulary.write` (Admin). New event `settings.vocabulary.changed@1` (no labels).
  - **A file store, `core.blob`.** Files are stored in the database, named by the SHA-256 of their content and served at
    `GET /files/{hash}` (`/api/internal/files/{hash}`, public) with `nosniff`, a strict Content-Security-Policy, a one-year
    cache and the hash as ETag. An upload is never stored as sent: the type is determined from the content (the client's
    `Content-Type` is ignored), rasters are decoded and written again without metadata and scaled to at most 2048 pixels,
    SVG is sanitised, anything else is refused with 422. Settings of `core.blob`: `maxBytes` (2 MiB, at most 8 MiB),
    `maxDimension`, `maxPixels` (decompression bombs) and `unreferencedGraceHours`. A file nothing refers to is removed by the
    hourly job `core.blob.cleanup` after 24 hours. `POST /files` (Admin, `core.blob.manage`) uploads logos; routes may now
    raise the 1 MiB request body limit for themselves. New permissions: `core.blob.upload` (role `user`) and
    `core.blob.manage` (Admin).
  - **Avatar.** `PUT /account/avatar` (the image as the request body) and `DELETE /account/avatar` for the signed-in person's own
    account; sessions only (an access token gets 403). The profile shows `avatarHash`. New permission
    `core.identity.avatar.update` (role `user`).
  - **Branding settings.** Product name, instance name, sender address, contact email, imprint link, light and dark logo (by
    file hash) and the terms, privacy policy and imprint as Markdown are the `branding` settings of `core.settings`
    (`PUT /settings/core.settings`). Public routes need no login: `GET /branding` and `GET /legal/{page}` (`terms`, `privacy`,
    `imprint`, rendered on the server and sanitised; raw HTML in a text shows as text). Mails use the instance name and sender
    from here. With no setting, the product is called `Scorpion` and the sender is `no-reply@localhost`.
  - **`instanceName` and `mailFrom` moved** from the settings of `core.identity` to `branding.instanceName` and
    `branding.mailFrom`. An existing database keeps them: a migration copies a stored value into the new place and removes
    it from the old one. A script that saves `core.identity` settings with those two keys now gets `422`.
  - **Database.** Three new migrations: two in `core.settings` (the vocabulary tables with their seeds written at start-up,
    and the branding move) and one in the new `core.blob` (`blob_blob`, `blob_reference`). An existing 0.3.x or 0.4 development
    database loses nothing and needs no manual step.

## 0.3.0

### Minor Changes

- 5b0899c: Personal access tokens. A signed-in person can create, list, revoke and rotate tokens: `GET` and `POST /api/internal/tokens`, `DELETE /api/internal/tokens/{id}` and `POST /api/internal/tokens/{id}/rotate` (send `{}`). A token looks like `scp_<8 characters>_<43 characters>`, is shown once when it is created or rotated and is stored only as an argon2id hash. Send it as `Authorization: Bearer <token>` or `X-API-Key: <token>`; such a request needs no `X-CSRF-Token` and ignores a session cookie. A token that is malformed, unknown, wrong, expired or revoked, or whose owner is not active, is answered with 401 (never 500). Tokens can only be managed with a session, not with another token. A token can have scopes (`read:kpi`, `write:registry.services`) and an expiry; scopes are checked in shape only until the authorisation module arrives. New permissions `core.identity.token.read` and `core.identity.token.manage`; new events `identity.token.created@1`, `.revoked@1` and `.rotated@1`. Failed token attempts are limited per address (10, then 10 a minute): after that every token request from that address gets 429 until it refills. With several server processes a revoked token can work for up to 5 more seconds on the other processes. A migration makes the token name unique among tokens that are not revoked.
- ede65b9: A fresh install gets its first administrator without the "first registrant" rule. New command `scorpion create-admin --username <name> --email <address>` (profiles with `core.identity`) creates an active administrator account; the password is read from the terminal prompt or from standard input (`printf '%s\n' "$PASSWORD" | scorpion create-admin …`), never from an argument, and appears in no output. Modules can now add commands to the `scorpion` CLI; the usage text lists those of your build. When the server or worker starts on an install that has no active user, it prints a one-time first-run token (`sfr_…`, valid for 1 hour) once to standard error as a plain-text block (not a log line, and never repeated); redeem it with `POST /api/internal/bootstrap/first-admin` and `{ "token", "username", "email", "password" }` to create the first administrator. It is single use, rate limited like login, and a taken username or a weak password does not use it up. Make sure the console output of the first start is captured, or use `create-admin`. New event `identity.admin.created@1`; new migration (table `identity_first_run_token`).
- 92abdb5: New hourly job `core.identity.cleanup`, run by `scorpion worker` (or by the web process in `WORKER_MODE=inline`). It removes expired and revoked sessions, expired OIDC login states, used and expired password-reset and email-confirmation tokens and expired first-run tokens, removes access tokens that expired or were revoked more than 30 days ago, and **purges accounts that were soft-deleted (rejected) more than 30 days ago**: their username and email address become free again, and the account's sessions, tokens and sign-in methods go with it. Each purge emits the new event `identity.user.purged@1` (user id and username) in the same transaction, for modules that keep rows about users. A run is one transaction and logs counts only. There is no lockout after failed logins: the per-address rate limit stays the protection (decision and reasons in the `core.identity` README and ADR-0013). Production still denies every route that is not public until `core.authz` arrives in M3.
- e9f4ac3: New module `core.identity` (profiles `full` and `kpi-tracker`): the migration that runs at start creates the tables `identity_user`, `identity_auth_method`, `identity_session`, `identity_login_state` and `identity_token`. They hold users, the ways they sign in, sessions and personal access tokens; secrets are stored only as hashes (argon2id for passwords and token secrets). Nothing uses them yet: there are no sign-in routes in this release, so an instance behaves as before. The request pipeline gains an authentication step (a registry `kernel.authenticator`, filled by this module from the next release on): a request without credentials is anonymous, bad credentials are a 401 except on public routes. Until the authorisation module arrives, every route that is not public still answers 403.
- 693ba39: People can now register and sign in with a password. New internal API endpoints: `POST /api/internal/auth/register`, `/auth/login`, `/auth/logout`, `/auth/logout-all`, `GET /auth/me`, and for approvers `GET /users/pending`, `POST /users/{id}/approve` and `/users/{id}/reject`. New accounts wait for approval (`approvalPolicy` is `manual`); rejecting one soft-deletes it. Signing in sets the `__Host-session` cookie (it needs HTTPS or `localhost`) and returns a `csrfToken` to send as `X-CSRF-Token` on writes. Register and login use the strict rate limit. The `localAccounts` setting (default on) is enforced by the server: when it is off, register and login answer 403. New permissions: `core.identity.session.manage`, `core.identity.me.read`, `core.identity.user.list-pending`, `core.identity.user.approve` and `core.identity.user.reject`. The events `identity.user.registered@1`, `identity.user.approved@1` and `identity.user.rejected@1` are written to the outbox. Until `core.authz` arrives in M3, every route except register and login still answers 403 in a real deployment.
- c2f8f15: OIDC sign-in now creates accounts and links identities. A first login with a provider creates a user under the approval policy (with the default `manual` policy the account waits for approval and gets a 403 and no session until an approver activates it); the email address is stored only when the provider verified it, and the username is derived from the provider's `preferred_username` or the address. An existing account is linked automatically only when the provider and Scorpion both verified the same address; an account whose address nobody confirmed (a password account) is never taken over: the login is a 409 that tells the person to sign in the usual way and link the provider from their profile. A signed-in user can add a provider to their account with `POST /api/internal/auth/oidc/{provider}/link` (new permission `core.identity.auth-method.link`; a session is required, an access token gets 403) followed by the same callback. New event `identity.authMethod.linked@1`; accounts created by OIDC emit `identity.user.registered@1`. OIDC provisioning never sets the temporary administrator marker, and a pending OIDC account does not end the first-run bootstrap.
- 096ad8b: People who already have an account in Scorpion can sign in through an OpenID Connect provider (defect 5: the old login had no PKCE, nonce or id_token validation). Configure providers in the `core.identity` setting `oidcProviders`, put each provider's client secret in the environment variable `OIDC_<ID>_CLIENT_SECRET` (the provider id in upper case, `-` becomes `_`; unset means a public client) and register `<ORIGIN><BASE_PATH>/api/internal/auth/oidc/<id>/callback` as the redirect URI at the provider. New routes `POST /api/internal/auth/oidc/{provider}/start` and `GET /api/internal/auth/oidc/{provider}/callback`, both rate limited like login. The login uses PKCE S256, a state and a nonce and checks the id_token completely; the state is single use, expires after 10 minutes and belongs to the browser that started the login (a short-lived `__Host-oidc-login` cookie). An unknown, expired or replayed state is a 400, a bad id_token a 401 and an unreachable provider a 502, and none of them creates a session. The `localAccounts` setting does not affect OIDC. A first login of a person Scorpion does not know yet is still refused; creating accounts follows in the next release of this series.
- 4349e9d: First step of OpenID Connect sign-in (defect 5): `core.identity` gets a setting `oidcProviders` (a list of `id`, `displayName`, `issuer`, `clientId`, `scopes`; empty by default, which keeps OIDC off), the checks an id_token must pass (signature by the provider's keys with RS256, PS256 or ES256, issuer, audience, expiry and nonce), a client for the provider's discovery document and keys (timeouts, size limit, caching), and the single-use login state. New migration: the table `identity_login_state` gets the columns `nonce_hash`, `binding_hash` and `link_user_id` (a login state lives 10 minutes, so no data is lost). New runtime dependencies `arctic` and `jose`. Nothing is reachable yet: the sign-in routes follow in the next releases of this series.
- f238039: Signed-in people can read and edit their own profile: new session-only routes `GET /api/internal/account/profile` and `PATCH /api/internal/account/profile` (display name, bio and email address; permissions `core.identity.profile.read` and `core.identity.profile.update`; new event `identity.profile.updated@1`, which lists the changed field names and never their values). The bio is plain text (at most 2000 characters). A new email address replaces the old one only after its owner opens the link mailed to it; until then the old address stays and the profile shows the new one as `pendingEmail`. Asking for the confirmation mail is limited to five address changes an hour per person, and `POST /api/internal/account/email/verification` answers 429 after five requests an hour. New migration (`display_name` and `bio` columns of `identity_user`). There is no avatar upload yet (needs the blob store of M3).
- ee04cb7: People who forgot their password can reset it by email, and everybody can confirm their email address. New public routes `POST /api/internal/auth/password-reset` (always answers 202, whether the address is known or not), `POST /api/internal/auth/password-reset/confirm` and `POST /api/internal/auth/verify-email`, and session-only routes `POST /api/internal/account/password` (change your own password) and `POST /api/internal/account/email/verification` (ask for a new confirmation mail). A reset or a password change ends every session of the account; personal access tokens keep working. Registering now sends a confirmation mail; until the link is opened the address counts as unconfirmed, and once it is confirmed an OIDC login with the same address can be linked to the account. Reset and change follow the `localAccounts` setting (403 when it is off). Set `SMTP_URL` (for development `smtp://localhost:1025`, the bundled Mailpit) to send mail; without it nothing is sent and the log only says that an email was not sent. Mail links are built from `ORIGIN` and `BASE_PATH`, carry the token in the URL fragment, and are never logged. New `core.identity` settings `instanceName` and `mailFrom` (defaults `Scorpion` and `no-reply@localhost`) name the instance and the sender until core.settings arrives; new permissions `core.identity.password.change` and `core.identity.email.verify`; new events `identity.password.resetRequested@1`, `identity.password.reset@1`, `identity.password.changed@1` and `identity.email.verified@1`. Adds Nodemailer as a dependency and one migration (`identity_mail_token`).
- 4e0ce69: core.identity now turns a `__Host-session` cookie into the signed-in user on every API call. The cookie is `Secure`, `HttpOnly` and `SameSite=Lax`, a session lasts 7 days from its last use, and the server stores only a hash of its id. Cookie-authenticated writes (anything but GET, HEAD and OPTIONS) must also send an `X-CSRF-Token` header (ADR-0007). With several server processes, a session that was revoked can still be accepted by another process for up to 5 seconds. There are no sign-in routes yet; they follow in the next change, so nothing changes for operators until then.
- b2a77ee: The server now rate-limits every module route (step 2 of the request pipeline). Each client address and each bearer token or API key gets a token bucket in PostgreSQL, so the limit holds across several server processes. A request over the limit is answered with `429` problem+json and a `Retry-After` header. Routes have two budgets, `default` (a burst of 120, then 120 a minute) and `strict` (a burst of 10, then 10 a minute) for login, register and token routes; `/healthz`, `/readyz` and `/metrics` are not limited. The new table `kernel_rate_bucket` is created by the migration that runs at start; idle buckets are pruned. Set the new `TRUSTED_PROXIES` variable (comma-separated IPs or CIDR ranges) when the server runs behind a reverse proxy: only a request from one of those addresses may tell the server the client's address through `X-Forwarded-For`. Without it the socket address is used, so every client behind a proxy would share one bucket.

## 0.2.0

### Minor Changes

- 17021b0: Each profile image now contains only that profile's modules and their dependencies: nothing from other profiles, no tests and no dev tools, so images are smaller and a plugin that is not in the profile cannot run. The Docker build takes optional build arguments `PROFILE_FILE` and `MODULE_ROOTS` for profiles outside `profiles/`. CI checks every image for stray modules.
- f0fb4bf: The server has a request pipeline. Every response carries an `X-Request-Id` (an incoming valid one is kept) and security headers (HSTS, a strict Content-Security-Policy, `X-Content-Type-Options`, `Referrer-Policy`, frame denial). Errors are RFC 9457 `application/problem+json` documents: invalid input is 422, a request body above 1 MiB is 413, and an unexpected error is a 500 that shows only the request id, never a stack trace. Routes are served under `BASE_PATH`, which can have any number of segments. Until the authorisation module exists, every route that is not explicitly public answers 403.
- a602078: The `scorpion` command line and the operational endpoints are here. `scorpion start` applies pending migrations and serves; `scorpion worker` runs jobs and events without HTTP; `scorpion migrate` migrates and exits. The server reads `DATABASE_URL` (required), `PROFILE`, `PORT`, `BASE_PATH`, `LOG_LEVEL`, `WORKER_MODE` (`inline` or `separate`) and `ORIGIN`, and stops at start-up with a list of everything that is wrong; secrets never appear in logs. `GET /healthz` says the process is alive and never touches the database, `GET /readyz` answers 503 until the database answers and all migrations are applied, and `GET /metrics` serves Prometheus metrics (process, HTTP duration by route, outbox lag, job durations). On SIGTERM the server finishes running requests, jobs and event handlers (up to 30 s) before it exits. An image refuses a `PROFILE` other than the one it was built for. Run the image with `DATABASE_URL` set.

### Patch Changes

- a6359d7: The project is licensed under the ISC licence. Every package now declares `"license": "ISC"` in its `package.json`.

## 0.1.1

### Patch Changes

- d6af528: The development stack and the integration tests now use pinned images (PostgreSQL 16.15 and Mailpit v1.31.3), so local and CI environments are reproducible. Pull requests that change only documentation no longer need a changeset. Nothing changes for running instances.

## 0.1.0

### Minor Changes

- 1bd1b73: M0: repository and toolchain bootstrap. The server answers `GET /healthz` with the active profile, the web app shows a placeholder page, and one container image is built per deployment profile (`full`, `denbi-registry`, `nfdi-onboarding`, `kpi-tracker`).
