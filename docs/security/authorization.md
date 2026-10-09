# Authorization

Who may do what in Scorpion, in one place: which route needs which permission, which checks the service repeats, who may read and write
which fields of each object, which fields only a dedicated route may change, and which fields no response ever holds. It documents what the
code does and why. The decisions are in [ADR-0005](../adr/0005-deny-by-default-before-authz.md) (deny by default),
[ADR-0014](../adr/0014-authorisation-model-and-dependency-direction.md) (the model) and
[ADR-0015](../adr/0015-identity-on-authz.md) (identity on authz); the mechanics of a decision (roles, the cache, token scopes, resource
policies) are in the [core.authz README](../../modules/core-authz/README.md) and are not repeated here. Authentication is in
[authentication.md](authentication.md), sessions in [sessions.md](sessions.md). This page backs ASVS 5.0 requirements 8.1.1, 8.1.2 and
8.2.3 ([docs/security/asvs/v8-authorization.yaml](asvs/v8-authorization.yaml)).

## Who can call

| Caller        | Is                                                | What it can do                                                                                                                         |
| ------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Anonymous     | No credential                                     | Only the routes marked **public** below. Every other route answers 401.                                                                |
| Session user  | A person with a session cookie                    | What the permissions of their roles allow. Roles are resolved from the database by user id; the client's idea of its roles is ignored. |
| Token         | A personal access token (`Authorization: Bearer`) | Only a permission that its scopes name **and** its owner holds. Routes that need a person, not a program, refuse it (403).             |
| Administrator | The role `admin`                                  | Every permission a loaded module declares, by resolution.                                                                              |

The roles `user` and `reviewer` are data. `user` holds the self-service permissions that the core modules contribute (`me.read`,
`session.manage`, the profile, avatar, password, e-mail, link and token permissions of `core.identity`, the inbox permissions and
`core.notifications.preference.read`, `core.settings.preference.read` and `.write`, `core.settings.vocabulary.read` and `core.blob.upload`); `reviewer` holds nothing
from the core. An administrator can change what a role holds, so the matrix names permissions, not roles.

## The two checks

Every request is checked twice, and the second check is the one that knows the resource.

1. **The route.** Every route declares `permission`, or `public: true` with a reason, or it fails when the module registers it. The
   request pipeline checks the permission before the handler runs and answers 401 (nobody) or 403 (not allowed). Nothing reaches a handler
   unchecked (ADR-0005, defect 1).
2. **The service.** Each service method that acts for a caller calls `ctx.authz.require(actor, permission, resource?)` again, so a job, another
   module or a future route cannot skip it. For an action on one resource the service passes the resource and checks it against the rows:
   whose it is, what state it is in, who asked for it. A permission is global; ownership and state are not, and the service decides them.

How each kind of route relies on the checks:

| Kind of route                                                                                               | Route check                        | Service check                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public (sign-in, registration, reset, first-run, branding, legal pages, files by hash)                      | none, with the reason in the route | The service validates the input and rate limits apply (`strict` bucket); a file is served by its content hash.                                                                                                                                                            |
| Self-service (sessions, tokens, profile, avatar, password, inbox, preferences)                              | the self-service permission        | Permission again, **and the rows are the caller's by construction**: the SQL is scoped to `actor.userId`, and no route takes a user id for these. Another user's row cannot be named, so it is answered like an unknown one (404), except an inbox item (403, see below). |
| Administration of other people (pending list, approve, reject, roles, end sessions, any token)              | the administrative permission      | Permission again, plus the built-in protections below (not your own request, not your own roles, not the last Admin).                                                                                                                                                     |
| Operation and configuration (settings, secrets, vocabularies, audit, outbox, deliveries, test mail, upload) | the module's permission            | Permission again; there is no resource below the permission.                                                                                                                                                                                                              |

## Routes and their permissions

One row per route of the live registry. The table is **generated**: `apps/server/src/authorization-doc.test.ts` builds it from the
registry and fails when this page differs, so it cannot drift from the code. To regenerate after adding or changing a route, run
`UPDATE_AUTHZ_DOC=1 pnpm exec vitest run --project @scorpion/server apps/server/src/authorization-doc.test.ts` (it needs Docker), then
`pnpm exec prettier --write docs/security/authorization.md`. Which roles hold a permission is data (previous section); the deny-by-default
walker of defect 1 (`apps/server/src/defect-01.privilege-escalation.test.ts`) fails when a route has no decision for a plain User, and
the same file answers 401 and 403 on every non-public route.

<!-- routes:start (generated by authorization-doc.test.ts, do not edit) -->

| Route                                           | Module                 | Permission                                   | Rate limit | Audited        |
| ----------------------------------------------- | ---------------------- | -------------------------------------------- | ---------- | -------------- |
| `GET /audit`                                    | core.audit             | `core.audit.read`                            | default    | no             |
| `GET /audit/{id}`                               | core.audit             | `core.audit.read`                            | default    | yes            |
| `GET /audit/export.csv`                         | core.audit             | `core.audit.export`                          | default    | yes, with body |
| `GET /system/job-runs`                          | core.audit             | `core.audit.system.read`                     | default    | no             |
| `GET /system/outbox`                            | core.audit             | `core.audit.system.read`                     | default    | no             |
| `POST /system/outbox/deliveries/{id}/requeue`   | core.audit             | `core.audit.system.manage`                   | default    | yes            |
| `GET /account/permissions`                      | core.authz             | `core.authz.account.read`                    | default    | no             |
| `GET /permissions`                              | core.authz             | `core.authz.role.read`                       | default    | no             |
| `PUT /roles/{key}/permissions`                  | core.authz             | `core.authz.role.manage`                     | default    | yes, with body |
| `GET /files/{hash}`                             | core.blob              | **public**                                   | default    | no             |
| `POST /files`                                   | core.blob              | `core.blob.manage`                           | strict     | yes            |
| `DELETE /account/avatar`                        | core.identity          | `core.identity.avatar.update`                | default    | no             |
| `DELETE /account/sessions/{id}`                 | core.identity          | `core.identity.session.manage`               | default    | yes            |
| `DELETE /tokens/{id}`                           | core.identity          | `core.identity.token.manage`                 | default    | yes            |
| `DELETE /users/{id}/roles/{role}`               | core.identity          | `core.identity.role.assign`                  | default    | yes            |
| `GET /account/profile`                          | core.identity          | `core.identity.profile.read`                 | default    | no             |
| `GET /account/sessions`                         | core.identity          | `core.identity.session.manage`               | default    | no             |
| `GET /auth/me`                                  | core.identity          | `core.identity.me.read`                      | default    | no             |
| `GET /auth/oidc/{provider}/callback`            | core.identity          | **public**                                   | strict     | no             |
| `GET /auth/oidc/providers`                      | core.identity          | **public**                                   | default    | no             |
| `GET /bootstrap/status`                         | core.identity          | **public**                                   | default    | no             |
| `GET /roles`                                    | core.identity          | `core.identity.role.read`                    | default    | no             |
| `GET /tokens`                                   | core.identity          | `core.identity.token.read`                   | default    | no             |
| `GET /users`                                    | core.identity          | `core.identity.user.read`                    | default    | no             |
| `GET /users/{id}`                               | core.identity          | `core.identity.user.read`                    | default    | no             |
| `GET /users/{id}/roles`                         | core.identity          | `core.identity.user.read`                    | default    | no             |
| `GET /users/{id}/tokens`                        | core.identity          | `core.identity.token.manage-any`             | default    | no             |
| `GET /users/pending`                            | core.identity          | `core.identity.user.list-pending`            | default    | no             |
| `PATCH /account/profile`                        | core.identity          | `core.identity.profile.update`               | default    | no             |
| `POST /account/email/verification`              | core.identity          | `core.identity.email.verify`                 | strict     | no             |
| `POST /account/oidc-link/confirm`               | core.identity          | `core.identity.auth-method.link`             | strict     | no             |
| `POST /account/password`                        | core.identity          | `core.identity.password.change`              | strict     | no             |
| `POST /account/reauthenticate`                  | core.identity          | `core.identity.session.manage`               | strict     | yes            |
| `POST /account/reauthenticate/oidc/{provider}`  | core.identity          | `core.identity.session.manage`               | strict     | yes            |
| `POST /auth/login`                              | core.identity          | **public**                                   | strict     | no             |
| `POST /auth/logout`                             | core.identity          | `core.identity.session.manage`               | default    | no             |
| `POST /auth/logout-all`                         | core.identity          | `core.identity.session.manage`               | default    | no             |
| `POST /auth/oidc/{provider}/link`               | core.identity          | `core.identity.auth-method.link`             | strict     | no             |
| `POST /auth/oidc/{provider}/start`              | core.identity          | **public**                                   | strict     | no             |
| `POST /auth/password-reset`                     | core.identity          | **public**                                   | strict     | no             |
| `POST /auth/password-reset/confirm`             | core.identity          | **public**                                   | strict     | no             |
| `POST /auth/register`                           | core.identity          | **public**                                   | strict     | no             |
| `POST /auth/verify-email`                       | core.identity          | **public**                                   | strict     | no             |
| `POST /bootstrap/first-admin`                   | core.identity          | **public**                                   | strict     | no             |
| `POST /system/sessions/revoke-all`              | core.identity          | `core.identity.session.manage-any`           | default    | yes            |
| `POST /tokens`                                  | core.identity          | `core.identity.token.manage`                 | strict     | yes            |
| `POST /tokens/{id}/rotate`                      | core.identity          | `core.identity.token.manage`                 | strict     | yes            |
| `POST /users/{id}/approve`                      | core.identity          | `core.identity.user.approve`                 | default    | yes, with body |
| `POST /users/{id}/deactivate`                   | core.identity          | `core.identity.user.deactivate`              | default    | yes            |
| `POST /users/{id}/reject`                       | core.identity          | `core.identity.user.reject`                  | default    | yes            |
| `POST /users/{id}/roles`                        | core.identity          | `core.identity.role.assign`                  | default    | yes, with body |
| `POST /users/{id}/sessions/revoke`              | core.identity          | `core.identity.session.manage-any`           | default    | yes            |
| `PUT /account/avatar`                           | core.identity          | `core.identity.avatar.update`                | strict     | no             |
| `DELETE /notifications/inbox/{id}`              | core.notifications     | `core.notifications.inbox.write`             | default    | no             |
| `GET /inbox/stream`                             | core.notifications     | `core.notifications.inbox.read`              | default    | no             |
| `GET /notifications/deliveries`                 | core.notifications     | `core.notifications.deliveries.read`         | default    | no             |
| `GET /notifications/inbox`                      | core.notifications     | `core.notifications.inbox.read`              | default    | no             |
| `GET /notifications/inbox/unread-count`         | core.notifications     | `core.notifications.inbox.read`              | default    | no             |
| `GET /notifications/preferences/categories`     | core.notifications     | `core.notifications.preference.read`         | default    | no             |
| `GET /notifications/status`                     | core.notifications     | `core.notifications.status.read`             | default    | no             |
| `POST /notifications/deliveries/{id}/requeue`   | core.notifications     | `core.notifications.deliveries.manage`       | default    | yes            |
| `POST /notifications/inbox/{id}/read`           | core.notifications     | `core.notifications.inbox.write`             | default    | no             |
| `POST /notifications/inbox/read-all`            | core.notifications     | `core.notifications.inbox.write`             | default    | no             |
| `POST /notifications/test`                      | core.notifications     | `core.notifications.test`                    | strict     | yes            |
| `DELETE /preferences/{key}`                     | core.settings          | `core.settings.preference.write`             | default    | no             |
| `DELETE /secrets/{name}`                        | core.settings          | `core.settings.secret.write`                 | default    | yes            |
| `DELETE /vocabularies/{vocabulary}/terms/{key}` | core.settings          | `core.settings.vocabulary.write`             | default    | yes            |
| `GET /branding`                                 | core.settings          | **public**                                   | default    | no             |
| `GET /legal/{page}`                             | core.settings          | **public**                                   | default    | no             |
| `GET /preferences`                              | core.settings          | `core.settings.preference.read`              | default    | no             |
| `GET /secrets`                                  | core.settings          | `core.settings.read`                         | default    | no             |
| `GET /settings`                                 | core.settings          | `core.settings.read`                         | default    | no             |
| `GET /settings/{module}`                        | core.settings          | `core.settings.read`                         | default    | no             |
| `GET /settings/{module}/schema`                 | core.settings          | `core.settings.read`                         | default    | no             |
| `GET /vocabularies`                             | core.settings          | `core.settings.vocabulary.read`              | default    | no             |
| `GET /vocabularies/{vocabulary}/terms`          | core.settings          | `core.settings.vocabulary.read`              | default    | no             |
| `PATCH /vocabularies/{vocabulary}/terms/{key}`  | core.settings          | `core.settings.vocabulary.write`             | default    | yes, with body |
| `POST /vocabularies/{vocabulary}/terms`         | core.settings          | `core.settings.vocabulary.write`             | default    | yes, with body |
| `PUT /preferences/{key}`                        | core.settings          | `core.settings.preference.write`             | default    | no             |
| `PUT /secrets/{name}`                           | core.settings          | `core.settings.secret.write`                 | strict     | yes            |
| `PUT /settings/{module}`                        | core.settings          | `core.settings.write`                        | default    | yes, with body |
| `GET /ui/navigation`                            | core.ui-shell          | **public**                                   | default    | no             |
| `DELETE /organisations/{id}`                    | registry.organisations | `registry.organisations.organisation.manage` | default    | yes            |
| `DELETE /organisations/{id}/logo`               | registry.organisations | `registry.organisations.organisation.manage` | default    | yes            |
| `GET /organisation-types`                       | registry.organisations | `registry.organisations.organisation.read`   | default    | no             |
| `GET /organisations`                            | registry.organisations | `registry.organisations.organisation.read`   | default    | no             |
| `GET /organisations/{id}`                       | registry.organisations | `registry.organisations.organisation.read`   | default    | no             |
| `GET /organisations/{id}/schema-org`            | registry.organisations | `registry.organisations.organisation.read`   | default    | no             |
| `PATCH /organisations/{id}`                     | registry.organisations | `registry.organisations.organisation.manage` | default    | yes            |
| `POST /organisations`                           | registry.organisations | `registry.organisations.organisation.manage` | default    | yes            |
| `PUT /organisations/{id}/logo`                  | registry.organisations | `registry.organisations.organisation.manage` | strict     | yes            |

<!-- routes:end -->

Public routes, and why each is open: sign-in, registration, password reset, address confirmation and the OIDC start and callback are how
anonymous people become signed-in ones, and carry the `strict` rate limit; `POST /bootstrap/first-admin` needs the first-run token that
only the console shows and only while nobody is Admin; `GET /bootstrap/status` answers one boolean (is an Admin still missing) so that the
start page of a fresh install can show the form for that token, and is `false` for good after the first Admin; `GET /auth/oidc/providers`
lists the id, the display name and the icon hash of each sign-in provider and nothing else (no issuer, no client id), which is what a
button needs; `GET /branding` and `GET /legal/{page}` are what the sign-in page shows; `GET /files/{hash}` serves logos, provider icons
and avatars to the sign-in page, and a file is named by the SHA-256 of its content.

The pages of the web app follow the same rule ([ADR-0027](../adr/0027-web-shell-catch-all-proxy-and-typed-client.md)): a page is public only
when its module says why and `PUBLIC_PAGES` of `core.ui-shell` lists it, and the server decides who may open a page from the same list that
builds the navigation. The sign-in, registration, recovery and first-admin pages are public; the profile needs
`core.identity.profile.read`. Public pages call only routes that are public or need the session the page checks for itself.

## Rules on one resource

These are the checks of the second kind. Each is in a service and each has tests.

| Resource                           | Rule                                                                                                                                                                                                                                          | Where                                            | Proved by                                                                                            |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Session                            | You list and end your own sessions; another user's session id is answered like an unknown one. An administrator ends all sessions of one user, or of everyone, with the separate permission `session.manage-any`.                             | `accounts.ts`, `sessions.ts`, `session-admin.ts` | `session-accounts.test.ts`, `session-admin.test.ts`, `sessions-routes.test.ts`                       |
| Token                              | You list, create, revoke and rotate your own tokens. A foreign id is answered like an unknown one (404). `token.manage-any` lets an administrator revoke any token; nobody can create or rotate someone else's. A token cannot manage tokens. | `tokens.ts`                                      | `tokens-routes.test.ts` ("one user cannot list, revoke or rotate another's token"), `tokens.test.ts` |
| Inbox item                         | You read, mark and delete your own items. A foreign item is a 403, the same as an unknown id, so ids cannot be probed.                                                                                                                        | `inbox.ts`                                       | `notification-routes.test.ts`                                                                        |
| Preference                         | You read and write your own preferences. No route names a user.                                                                                                                                                                               | `preferences.ts`                                 | `settings-routes.test.ts`, `defect-01` ("lets nobody read another user's preferences")               |
| Profile, avatar, password, address | The row is the caller's from the actor; there is no user id to change.                                                                                                                                                                        | `profile.ts`, `recovery.ts`                      | `profile.test.ts`, `blob-routes.test.ts`                                                             |
| Pending account                    | Approve and reject act on an account that is waiting; the decider is never the account itself.                                                                                                                                                | `approval.ts`                                    | `approval.test.ts`                                                                                   |
| Role assignment                    | Never your own roles; the last Admin stays.                                                                                                                                                                                                   | `core.authz`                                     | `authz.test.ts`, `roles.test.ts`                                                                     |

## The rules that hold for everyone, Admin included

They are in the service, so no route has to remember them.

- **Nobody changes their own roles** (403), in `assignRole` and `removeRole` of `core.authz`. Tests: `authz.test.ts` ("refuses changing
  your own roles, even for Admin and in any letter case"), `roles.test.ts` ("refuses to change your own roles, Admin included, and keeps the
  last Admin"), `defect-01.privilege-escalation.test.ts` ("refuses Admin to change their own roles, and to approve or reject their own account").
- **Nobody approves or rejects their own request** (403). The account is the request: `approval.ts` passes `{ approval: true, requestedBy }`
  to `require`, and `core.authz` refuses when the requester is the caller, whatever roles they hold and whatever a resource policy says.
  Tests: `approval.test.ts` ("refuses to approve your own account", "refuses an approval on your own account whatever you hold, also with the
  permission in a custom role"), `defect-01` ("refuses an approver who holds the permission in a custom role to approve their own account").
- **The last Admin cannot be removed** (409), also when two removals run at once (`authz.test.ts`). "Last" counts accounts that can sign in: a deactivated Admin does not count, and the last active Admin cannot be deactivated either (`roles.test.ts`, `user-admin.test.ts`).
- **A token is limited twice**: by its scopes and by what its owner holds (scope ∩ owner). A token with the broadest scopes cannot do what
  its owner cannot (`defect-01`, "answers 403 to a token on every admin route, whatever its scopes name, when its owner is a plain User").
- **Sensitive account changes need a recent authentication** (ADR-0025): changing the address, linking a provider, ending sessions
  (401 `reauthentication-required`).

## Fields, per object

There is **no field-level permission engine**, and none is needed for the objects that exist (M4b Decision 9). Field-level access is kept by
three plain rules, each enforced in code and tested:

1. **Reads have one shape per route.** A response is a fixed Zod schema listing the fields; the service builds it from named columns, never by
   returning a row. Two kinds of reader who may see different fields of one object (you and an administrator) use two different routes with two
   schemas. The walker `apps/server/src/response-fields.test.ts` fails when any response schema of the live registry, at any depth, names
   `secretHash`, `passwordHash`, `tokenHash`, `clientSecret`, `secret`, `password` or `token`. The only exceptions are the two responses that show a
   token's plaintext once, to its owner: `POST /tokens` and `POST /tokens/{id}/rotate`.
2. **Writes accept only the fields of their route.** Every request body is a strict Zod object: an unknown field (`status`, `roles`, `userId`) is a
   422, never ignored and never stored, so mass assignment is not possible. A field that only a dedicated route may change has no place in any
   other body.
3. **State decides what may change.** A rule that depends on the state of the object (a pending account, a revoked or expired token, a used link)
   is enforced in the service on the stored row, not in the client.

In the tables, **self** is the caller acting on their own object, **holder** is the holder of the permission named, and **Admin** is the role.
"Dedicated route" means the field changes only through that route and its permission.

### User account

| Field                                                     | Read                                                                                                                              | Write                                                                                                                                                                                                                                                                                                                                                                                        | Notes                                                                                                                                       |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`, `username`, `emailVerified`, `status`               | self (`GET /auth/me`); holder of `core.identity.user.read` (`GET /users`, `GET /users/{id}`)                                      | `username`: never after creation. `status`: only a dedicated route (see below)                                                                                                                                                                                                                                                                                                               | `GET /account/profile` shows `username` and `emailVerified` too.                                                                            |
| `email`                                                   | self; holder of `user.list-pending` sees it on pending accounts; holder of `user.read` on every account                           | self, through `PATCH /account/profile`: a new address is **pending** until the mailed link is used, and needs a recent authentication                                                                                                                                                                                                                                                        | `pendingEmail` is shown to self only.                                                                                                       |
| `displayName`, `bio`                                      | self; `displayName` also to a holder of `user.read`, `bio` never                                                                  | self                                                                                                                                                                                                                                                                                                                                                                                         | Plain text; a UI shows it as text, never as HTML. Nobody reads another user's profile: there is no such route.                              |
| `avatar` (`avatarHash`)                                   | self; the file is public by its hash                                                                                              | self, `PUT` and `DELETE /account/avatar`                                                                                                                                                                                                                                                                                                                                                     | The image is re-encoded before it is stored.                                                                                                |
| `status` (`pending`, `active`, `rejected`, `deactivated`) | self (`/auth/me`); the pending list shows pending accounts                                                                        | **Dedicated routes:** `POST /users/{id}/approve` and `/reject` (`core.identity.user.approve`, `.reject`), never your own; `POST /users/{id}/deactivate` (`core.identity.user.deactivate`), never your own, not the last active Admin, and it ends the sessions in the same transaction; an approval policy at registration; the hourly cleanup, which purges rejected accounts after a delay | A profile body with `status` is a 422 (`profile.test.ts`).                                                                                  |
| roles                                                     | self sees their own through `/auth/me`; holder of `user.read` and `core.authz.role.read` sees another's (`GET /users/{id}/roles`) | **Dedicated routes:** `POST /users/{id}/roles` and `DELETE /users/{id}/roles/{role}` (`core.identity.role.assign`, `core.authz.role.assign`), never your own                                                                                                                                                                                                                                 | A role cannot be sent in the approval of anything but `POST /users/{id}/approve`, which names the role to give and needs `role.assign` too. |
| password                                                  | **never returned**                                                                                                                | self, `POST /account/password` (current password and a recent authentication), or the reset link                                                                                                                                                                                                                                                                                             | Stored as an Argon2id hash in `identity_auth_method`; no route returns it.                                                                  |
| linked sign-in providers                                  | not listed by any route                                                                                                           | self, with mailbox confirmation (ADR-0026)                                                                                                                                                                                                                                                                                                                                                   |                                                                                                                                             |

### Role

| Field                                   | Read                                                                          | Write                                                                               | Notes                                                                                        |
| --------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `key`, `label`, `system`, `permissions` | holder of `core.identity.role.read` (`GET /roles`)                            | `PUT /roles/{key}/permissions` (`core.authz.role.manage`), never for Admin; audited | Admin cannot be edited; a stored permission that no loaded module declares is never granted. |
| assignments                             | self (own roles); holder of `core.authz.role.read` for others, in the service | holder of `role.assign`, never on yourself                                          | The last Admin stays.                                                                        |

### Access token

| Field                                                                    | Read                                                                                                                                                   | Write                                                                                                              | Notes                                                                                                                        |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `id`, `name`, `prefix`, `scopes`, `expiresAt`, `lastUsedAt`, `createdAt` | the owner (`GET /tokens`)                                                                                                                              | `name`, `scopes` and `expiresAt` are set at creation; `rotate` may set a new `expiresAt`; the rest is the server's | The `prefix` is the public lookup half and is not a secret.                                                                  |
| the token itself (`token`)                                               | **once**, to the owner, in the response of `POST /tokens` and `POST /tokens/{id}/rotate` (`Cache-Control: no-store`); never again                      | not writable                                                                                                       | The database holds only an Argon2id hash.                                                                                    |
| `secretHash`                                                             | **never returned**                                                                                                                                     | the server                                                                                                         |                                                                                                                              |
| revocation                                                               | the owner; an administrator with `token.manage-any` can list the open tokens of a user (`GET /users/{id}/tokens`, never a secret) and revoke one by id | owner, or `token.manage-any`                                                                                       | A revoked token never works again. Another user's token is listed only to a holder of `token.manage-any`, through a session. |

### Session

| Field                                      | Read                                | Write                                                                                                    | Notes                                                                                         |
| ------------------------------------------ | ----------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `id`, `createdAt`, `lastSeenAt`, `current` | the owner (`GET /account/sessions`) | none; ended by the owner (`DELETE /account/sessions/{id}`) or by an administrator (`session.manage-any`) | The list shows times and the current marker only: no address, no user agent (M4b Decision 6). |
| `secretHash`, expiry, `authenticatedAt`    | **never returned**                  | the server                                                                                               | The cookie holds an opaque id; the database holds a hash.                                     |

### Inbox item

| Field                                                            | Read               | Write                                                                              | Notes                                                                                                              |
| ---------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `id`, `template`, `title`, `text`, `link`, `createdAt`, `readAt` | the recipient only | `readAt` by the recipient (`POST .../read`, `read-all`); deletion by the recipient | Created by the server from a template; no route creates an item. A sensitive template leaves nothing in the inbox. |

### Setting (configuration of a module)

| Field                                                   | Read                           | Write                                                                                                                                      | Notes                                                                                                      |
| ------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `module`, `version`, `values`, `updatedAt`, `updatedBy` | holder of `core.settings.read` | holder of `core.settings.write`, with the version it read (a stale write is a 409); the values are checked against the module's own schema | A secret is never a setting: secrets are a separate object. `updatedBy` is the user id of the last editor. |
| `branding`, legal pages                                 | **anyone** (public)            | settings writers                                                                                                                           | Only the fields the sign-in page needs: names, contact address, imprint link, logos, legal text.           |

### Secret

| Field                      | Read                                        | Write                                                                    | Notes                                                                                                            |
| -------------------------- | ------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `name`, `set`, `updatedAt` | holder of `core.settings.read`              | holder of `core.settings.secret.write` (`PUT`, `DELETE /secrets/{name}`) |                                                                                                                  |
| value                      | **never returned**, by any route, to anyone | write only                                                               | Stored encrypted (AES-GCM, `SECRETS_KEY`); no secret appears in a response, a log, an event or an audit payload. |

### Vocabulary and term

| Field                                                                                                  | Read                                                                                    | Write                        | Notes                                            |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------ |
| `id`, `description`, `terms`, `activeTerms`; a term's `key`, `labels`, `sortOrder`, `active`, `seeded` | holder of `vocabulary.read` (every `user`); inactive terms only with `vocabulary.write` | holder of `vocabulary.write` | A seeded term can be deactivated, never deleted. |

### Preference

| Field                       | Read      | Write                                                                              | Notes                  |
| --------------------------- | --------- | ---------------------------------------------------------------------------------- | ---------------------- |
| `key`, `value`, `updatedAt` | the owner | the owner; the value is checked against the schema a module registered for the key | No route names a user. |

### File (blob)

| Field                   | Read                                                                            | Write                                                                         | Notes                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| content, `mime`, `size` | anyone who knows the hash (public route), with a strict content-security policy | `POST /files` (`core.blob.manage`, session only); avatars through the profile | The stored type is the one found from the content; rasters are re-encoded and SVG is sanitised. |
| `id`, `hash`, `url`     | the uploader, in the response of `POST /files`                                  | the server                                                                    | The hash is the SHA-256 of the content, a name and not a secret.                                |

### Audit entry

| Field                                                                                                                                                          | Read                                                                                       | Write                                               | Notes                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`, `occurredAt`, `source`, `action`, `outcome`, `actorKind`, `userId`, `tokenId`, `ip`, `method`, `path`, `status`, `requestId`, `subjectType`, `subjectId` | holder of `core.audit.read` (`GET /audit`, `/audit/{id}`); `core.audit.export` for the CSV | **nobody**: written by the server only, append only |                                                                                                                                                                                                                        |
| `query`, `body`, `payload`                                                                                                                                     | the same readers, **redacted**                                                             | the server                                          | A key that looks like a password, token, secret, authorization header, API key, code or value is replaced by `[redacted]` at any depth, and the text is capped (ADR-0021). A route under `/auth/` never stores a body. |

### Notification delivery and event outbox (operation)

| Field                                                                                                                                            | Read                                           | Write                                        | Notes                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------ |
| a delivery's `id`, `template`, `channel`, `status`, `attempts`, `lastError`, `transport`, `sensitive`, `recipientUserId`, `bodyAvailable`, times | holder of `core.notifications.deliveries.read` | the server; `requeue` by `deliveries.manage` | The recipient's address and the body are **never returned**. |
| the outbox's `stats` and dead deliveries                                                                                                         | holder of `core.audit.system.read`             | `requeue` by `core.audit.system.manage`      | The event payload is not returned.                           |

### Mail tokens, login states and the first-run token

| Field      | Read                            | Write      | Notes                                                                                                                                                                                                                                                                     |
| ---------- | ------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| everything | **never returned** by any route | the server | The reset, confirmation and link tokens, the OIDC login state (hashes of `state`, `nonce` and the PKCE challenge) and the first-run token are kept only as hashes, are single use and expire. The plaintext of a mail token is in the mail to its owner and nowhere else. |

## What the audit trail, events and logs hold

The same names are kept out of the three records, and each has its own test:

- **Audit trail:** the redaction above; `audit-routes.test.ts` ("stores a body and query only for the route that opted in, redacted at any
  depth" and the reset token, SMTP password and webhook secret cases).
- **Events:** a declared event holds ids, names and counts, never a credential (the token events carry the token's id and name, not its
  prefix or hash); the event schemas are strict (`decisions.test.ts` in `core.audit`), and `response-fields.test.ts` fails when a declared event names a secret.
- **Logs:** no password, hash, token or secret is logged; the existing tests of sprint 2 and `tokens-routes.test.ts` ("never contains a
  token, its secret, its hash or a password, through a whole life of one") read the logs of a full run.

## What this page does not claim

- **No per-role field projection.** An Admin sees the same fields of an object as anyone else with the permission; there are only the
  differences the tables name, and each is a separate route.
- **Resource policies** (access to one resource for a caller without the global permission, such as membership of a provider) exist as a
  mechanism in `core.authz` and are tested with a fixture module. The first real policies arrive with the registry modules (M7), and this
  page gets their rows then.
- **Contextual attributes** (time of day, address, device) are not used in any authorization decision. The only context is the recent
  authentication of a session, in [sessions.md](sessions.md).
- The routes of `registry.organisations` (M6) are in the table. The field tables of the organisation (the contact point, the logo and
  the two editor groups) arrive with M6 sprint 4; until then the contact point and the audit columns of an organisation are read by
  administrators only. The matrix is regenerated, and the walker and the response guard cover the routes of every registry module
  automatically.
