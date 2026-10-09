# core.authz

Roles as data, the permission registry and the authoriser of the request pipeline. It decides who may
do what and knows nothing about users: it stores an opaque user id with no foreign key and imports
nothing from `core.identity` (ADR-0014). It has no dependencies, so every other module may depend on it.

Status: M3 sprint 2. The module is in the `full` and `core-only` profiles and `core.identity` depends on it
([ADR-0015](../../docs/adr/0015-identity-on-authz.md)): identity contributes the permissions of the role `user`, gives
the role at approval, owns the role routes and asks this module for every decision. An anonymous caller of a
non-public route gets 401, a signed-in user without a role 403. `core.settings` (sprint 3) depends on it too: it uses
`ctx.deps['core.authz']` in every service method and contributes the two preference permissions to the role `user`
through `authz.defaultRole`; the module order is `core.authz` → `core.settings` → `core.identity`. This module still reads
no settings (ADR-0014).

## Manifest

| Part           | Value                                                                                                                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id             | `core.authz`                                                                                                                                                                                 |
| table prefix   | `authz_` (set in the manifest; ADR-0004)                                                                                                                                                     |
| dependencies   | none (ADR-0014)                                                                                                                                                                              |
| routes         | `PUT /roles/{key}/permissions`, `GET /permissions` and `GET /account/permissions`; listing roles and giving one are `core.identity`'s ([ADR-0015](../../docs/adr/0015-identity-on-authz.md)) |
| jobs, CLI      | none                                                                                                                                                                                         |
| events         | emits `authz.role.assigned@1`, `authz.role.removed@1` and `authz.role.permissions.changed@1`, see "Events"                                                                                   |
| contributes    | `kernel.authorizer`: the one entry of the route authoriser (ADR-0005); `authz.defaultRole`: `core.authz.account.read` for the role `user`                                                    |
| public service | `ctx.deps['core.authz']`, see "Public API"                                                                                                                                                   |

### Permissions

| Permission                | Allows                                       | Held by default by |
| ------------------------- | -------------------------------------------- | ------------------ |
| `core.authz.role.read`    | List roles and read the roles of other users | Admin              |
| `core.authz.role.assign`  | Give a role to a user and take it away       | Admin              |
| `core.authz.role.manage`  | Change which permissions a role holds        | Admin              |
| `core.authz.account.read` | List the permissions you hold                | User               |

Admin holds every permission that a loaded manifest declares, so the table shows what the module adds, not a
list that has to be kept up to date.

### Registries

| Registry               | Entry                                                                  | Used for                                                                                    |
| ---------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `authz.defaultRole`    | `{ role: 'reviewer', permissions: ['kpi.set.review', ...] }`           | A module gives a seeded role its permissions without editing `core.authz`.                  |
| `authz.resourcePolicy` | `{ resourceType: 'service', allows({ actor, permission, resource }) }` | Access to one resource for callers who lack the permission globally (`service.member`, M7). |

`authz.defaultRole` entries are applied once per role and permission, recorded in `authz_default_grant`:
a permission an administrator removes from Reviewer does not come back at the next start, and a permission
a module adds in a later release still reaches an existing instance. An entry for a missing role or an
undeclared permission is logged and ignored. Admin needs no entries.

A contributing module must depend on `core.authz` in its `package.json` (ADR-0002).

## How a decision is made

1. **Roles are data.** `authz_role` (seeded: `admin`, `reviewer`, `user`, with `system = true`),
   `authz_role_permission` (stored permissions of a role) and `authz_role_assignment` (user id, role;
   unique per pair). All keys are UUIDv7. `authz_default_grant` remembers which defaults were applied.
2. **The permission registry is `ctx.permissions`**, filled by the kernel from every loaded manifest. A permission
   that no manifest declares cannot be stored (`setRolePermissions` answers 422 and stores nothing). A stored one
   that is no longer declared (its module left the profile) is **logged once and ignored, never granted**.
3. **Admin is resolved at check time.** It holds every declared permission and has no rows in
   `authz_role_permission`, so a permission of a module added later reaches Admin without a data migration.
   Admin cannot be edited (403).
4. **The authoriser** (`kernel.authorizer`) reads `actor.userId`, resolves the roles itself and ignores
   `actor.roles`: anonymous → 401, missing permission → 403. A scoped permission is checked globally at the route;
   its resource check belongs to the service (`ctx.deps['core.authz'].require(actor, permission, resource)`).
5. **Token scopes** are permission ids. A token actor (`via: 'token'`) passes only for a permission that its scopes
   name **and** its owner holds (scope ∩ owner), for the route (`authorizeRoute`) and for `require`/`can` in a
   service; the scope gate also covers resource policies, so a token cannot reach through a policy what it was not
   given. A token without scopes can do nothing; a scope that names a permission the owner lacks grants nothing; a
   session is not limited by scopes. `grants` and `withinScopes` in `service/permissions.ts` are the pure rule, with
   table-driven tests. A role taken from the owner takes effect for the token like for the owner (the cache bound
   below).

### Built-in protections

They live in the service, so no route and no future module has to remember them, and they hold for Admin too.

- **Nobody changes their own roles** (403), in `assignRole` and `removeRole`.
- **Nobody approves their own request.** A service that decides on a request passes
  `{ type, approval: true, requestedBy }` as the resource; when `requestedBy` is the caller, `require` answers 403
  whatever the roles are, and no resource policy can undo it.
- **The last Admin cannot be removed** (409). Removals of a role take turns on a row lock, so two at once cannot both
  succeed. Authz cannot tell whether an Admin's account still exists, so a deactivated Admin counts until the purge
  removes their assignment (`removeAllAssignments`, below).

### The cache and its bound

The permissions of a user are cached in process for **5 seconds** (`PERMISSION_CACHE_TTL_MS`). A role change
empties the cache of this process at once (for one user on assign and remove, for everyone on an edited role).
**Another server process learns of it when its entry expires, so with several processes a demoted user can keep a
permission there for at most 5 seconds**, the same bound as sessions (ADR-0007). Every write in this service
decides from the database, not from the cache, so a demoted administrator cannot use a stale entry to change roles.
Tests cover the bound with two kernels over one database.

## Public API (`public.ts`)

`ctx.deps['core.authz']` is an `AuthzService`:

| Method                                      | Needs                    | Notes                                                                      |
| ------------------------------------------- | ------------------------ | -------------------------------------------------------------------------- |
| `require(actor, permission, resource?)`     |                          | Resolves, or 401 (anonymous) / 403. `can(...)` is the boolean form.        |
| `listRoles(actor)`                          | `core.authz.role.read`   | Declared permissions only; Admin lists all.                                |
| `listPermissions(actor)`                    | `core.authz.role.read`   | Every declared permission with its module and description.                 |
| `permissionsHeldBy(actor)`                  | signed in                | What the caller holds now (scope ∩ owner for a token); 401 for anonymous.  |
| `rolesOf(actor, userId)`                    | own, or `role.read`      | Role keys.                                                                 |
| `assignRole(actor, { userId, roleKey })`    | `core.authz.role.assign` | Idempotent (`false` when already held). 404 unknown role, 422 bad user id. |
| `removeRole(actor, { userId, roleKey })`    | `core.authz.role.assign` | `false` when not held. 409 for the last Admin.                             |
| `setRolePermissions(actor, roleKey, [...])` | `core.authz.role.manage` | Replaces the set in one transaction.                                       |

Each method checks its permission itself, so every caller is protected, including jobs. The identity routes declare
their own route permission (`core.identity.role.*`) and call these methods, so a role change needs both pairs
(ADR-0015). `assignRole` and `removeRole`, called inside the caller's `ctx.db.tx()`, join that transaction (a
savepoint): this is how an approval gives its role atomically.

Four methods are for **trusted code with no human caller** and check no permission. Only a module that may hand out
roles uses them; the trust boundary is the profile's module list, as for contributing to `kernel.authorizer`
(ADR-0005), and no `Actor` of kind `system` exists:

| Method                                         | Used by                                                               | Notes                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assignRoleAsSystem(tx, { userId, roleKey })`  | `create-admin`, the first-run token, an account activated by a policy | `assigned_by` null; emits `authz.role.assigned@1` with actor `null` in the caller's transaction (`tx` must be the one of `ctx.db.tx()`). Never removes. 404 unknown role, 422 bad id.                                                                                                                                         |
| `removeAllAssignments(tx, userId)`             | the purge of an account (identity's cleanup job)                      | Deletes every assignment of the user in the caller's transaction, no event, the last-Admin rule is not applied (a purged account is a rejected one). Returns how many.                                                                                                                                                        |
| `listHoldersAsSystem(tx, roleKey, { limit? })` | "all administrators" (identity's registration mail to every admin)    | The ids of the users who hold the role, in id order, at most `limit` (default and maximum 1000); an unknown role has none. Reads in the caller's transaction. A test proves that core.authz registers no route and that no `routes*.ts` file of any module names this method, `assignRoleAsSystem` or `removeAllAssignments`. |
| `hasHolders(roleKey, tx?)`                     | "no administrator yet" (bootstrap)                                    | Whether any user holds the role; names nobody.                                                                                                                                                                                                                                                                                |

### Events

`authz.role.assigned@1` and `authz.role.removed@1`, emitted inside the transaction of the change:
`{ userId, roleKey, actorId }`, where `actorId` is the caller or `null` for the system. Nothing else (no permission list,
no secret). A repeat of a change (the role was held already, or not) emits nothing.

`authz.role.permissions.changed@1`, emitted by `setRolePermissions` in the transaction that replaces the set:
`{ roleKey, added, removed, actorId }`, where `added` and `removed` are sorted permission strings (never user data) and
`actorId` is the caller. Saving the set a role already has emits nothing. `core.audit` subscribes to all three (ADR-0021).

## Routes

Three internal routes (the screens of roles and of the token form, M5):

| Route                          | Permission                | Notes                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------ | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUT /roles/{key}/permissions` | `core.authz.role.manage`  | `{ permissions: [...] }` (at most 1000 ids) replaces what the role holds and answers the role. 403 for Admin (it holds everything and cannot be edited), 404 unknown role, 422 for a permission no loaded module declares (nothing is stored). Audited with its body; the event `authz.role.permissions.changed@1` is emitted only when the set changed. Takes effect at once in this process |
| `GET /permissions`             | `core.authz.role.read`    | Every permission a loaded module declares: `{ id, module, description }`, by id, in the list envelope (default page size 100, at most 500). What the roles page groups by module and describes. The description is the module's own English text.                                                                                                                                             |
| `GET /account/permissions`     | `core.authz.account.read` | What the caller holds now, same shape. For an access token only the scopes it names as well (scope ∩ owner). Read from the database, never the cache. What the token form offers as scopes.                                                                                                                                                                                                   |

The system methods above are not reachable from them: a test (`module.test.ts`) registers the routes against a stand-in that fails when one is touched.

## Tables

`authz_role`, `authz_role_permission`, `authz_default_grant`, `authz_role_assignment`. Create a migration after
a change with `pnpm db:generate --filter @scorpion/core-authz`. The seed runs when the service is built (every
start and every CLI command) and is idempotent, also when two processes start at once.

## Testing

`test/harness.ts` starts a kernel over Postgres with fixture modules that declare permissions and contribute to
the registries. Other modules' tests start this module for real (see `core.identity`'s `test/harness.ts`) instead of
using a stand-in authoriser. The factories `makeRole` and `makeRoleAssignment` are in `@scorpion/testing`. Permission matching
is a pure function with table-driven tests (`service/permissions.test.ts`).
