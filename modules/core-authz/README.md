# core.authz

Roles as data, the permission registry and the authoriser of the request pipeline. It decides who may
do what and knows nothing about users: it stores an opaque user id with no foreign key and imports
nothing from `core.identity` (ADR-0014). It has no dependencies, so every other module may depend on it.

Status: M3 sprint 1. The module is in the `full` and `kpi-tracker` profiles, but `core.identity` does not
use it yet (sprint 2), so nobody holds a role by themselves and a signed-in user still gets 403 on every
route that is not public, as in 0.3.0. The one change you can see: an anonymous caller of a non-public
route now gets 401 instead of 403.

## Manifest

| Part           | Value                                                                 |
| -------------- | --------------------------------------------------------------------- |
| id             | `core.authz`                                                          |
| table prefix   | `authz_` (set in the manifest; ADR-0004)                              |
| dependencies   | none (ADR-0014)                                                       |
| routes         | none yet; the role routes are `core.identity`'s (sprint 2)            |
| jobs, CLI      | none                                                                  |
| events         | none yet: `authz.role.assigned@1` and `.removed@1` arrive in sprint 2 |
| contributes    | `kernel.authorizer`: the one entry of the route authoriser (ADR-0005) |
| public service | `ctx.deps['core.authz']`, see "Public API"                            |

### Permissions

| Permission               | Allows                                       | Held by default by |
| ------------------------ | -------------------------------------------- | ------------------ |
| `core.authz.role.read`   | List roles and read the roles of other users | Admin              |
| `core.authz.role.assign` | Give a role to a user and take it away       | Admin              |
| `core.authz.role.manage` | Change which permissions a role holds        | Admin              |

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
5. **Token scopes** are not applied yet. The seam is marked in `service/authz.ts` (`authorizeRoute`); sprint 2
   intersects a token's scopes with the owner's permissions there. Until then a token would have its owner's
   permissions, which is harmless because no user holds any role.

### Built-in protections

They live in the service, so no route and no future module has to remember them, and they hold for Admin too.

- **Nobody changes their own roles** (403), in `assignRole` and `removeRole`.
- **Nobody approves their own request.** A service that decides on a request passes
  `{ type, approval: true, requestedBy }` as the resource; when `requestedBy` is the caller, `require` answers 403
  whatever the roles are, and no resource policy can undo it.
- **The last Admin cannot be removed** (409). Removals of a role take turns on a row lock, so two at once cannot both
  succeed. Authz cannot tell whether an Admin's account still exists, so a deactivated Admin counts until the purge
  removes their assignment (sprint 2).

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
| `rolesOf(actor, userId)`                    | own, or `role.read`      | Role keys.                                                                 |
| `assignRole(actor, { userId, roleKey })`    | `core.authz.role.assign` | Idempotent (`false` when already held). 404 unknown role, 422 bad user id. |
| `removeRole(actor, { userId, roleKey })`    | `core.authz.role.assign` | `false` when not held. 409 for the last Admin.                             |
| `setRolePermissions(actor, roleKey, [...])` | `core.authz.role.manage` | Replaces the set in one transaction.                                       |

Each method checks its permission itself, so every caller is protected, including jobs. Sprint 2's identity
routes declare their own route permission and call these methods.

## Tables

`authz_role`, `authz_role_permission`, `authz_default_grant`, `authz_role_assignment`. Create a migration after
a change with `pnpm db:generate --filter @scorpion/core-authz`. The seed runs when the service is built (every
start and every CLI command) and is idempotent, also when two processes start at once.

## Testing

`test/harness.ts` starts a kernel over Postgres with fixture modules that declare permissions and contribute to
the registries. The factories `makeRole` and `makeRoleAssignment` are in `@scorpion/testing`. Permission matching
is a pure function with table-driven tests (`service/permissions.test.ts`).
