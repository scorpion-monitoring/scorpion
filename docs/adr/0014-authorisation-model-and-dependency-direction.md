# ADR-0014: Authorisation model, dependency direction and the bootstrap exception

- Status: Accepted
- Date: 2026-10-02

## Context

M3 fills the `kernel.authorizer` hook that ADR-0005 left on deny-by-default. `core.authz` stores roles
as data and decides; `core.identity` owns users, sessions and tokens and must ask `core.authz` who
may do what (`ctx.authz.require`, CLAUDE.md). FEATURES §2 draws the module arrow the other way round
(authz depends on identity). FEATURES comes from the legacy app, whose defect 1 (privilege escalation)
is what this milestone closes, so it is a requirements baseline and not an architecture to copy where
the architecture says otherwise.

## Decision

### Dependency direction

- **`core.identity` depends on `core.authz`; `core.authz` is user-agnostic.** It stores an opaque user
  id with no foreign key to `identity_user` and imports nothing from identity. FEATURES §2 is not
  followed on this arrow.
- **Module graph** (no cycle): `core.authz` → `core.settings` → `core.blob` → `core.identity`, read
  as "left is depended on". Migrations run in this order, so an identity migration may run after the
  authz tables exist. Every profile that lists a module lists its dependencies; `defineProfile()` and
  `modules:sync` check this.
- **`core.authz` reads no settings.** Its cache TTL and defaults are constants, so `core.settings` can
  depend on it.
- **No foreign key to a user** means a purge of a user cannot be blocked by role assignments, and
  authz can be tested without identity.
- **Purge calls authz, it does not publish to it.** A module may subscribe only to its own events and
  to those of its dependencies (ADR-0003), so `core.authz` cannot subscribe to
  `identity.user.purged@1`. The cleanup job's purge transaction therefore calls the authz service
  (`removeAllAssignments(tx, userId)`) before it deletes the user row: same transaction, no orphan
  row, no event needed. Implemented in sprint 2.

### The authorizer and `ctx.authz`

- `core.authz` contributes the one entry of `kernel.authorizer` (ADR-0005). It resolves the roles of
  `actor.userId` itself. An anonymous caller gets 401, a missing permission 403. `Actor.roles` stays
  as the authenticator fills it and is not trusted for decisions.
- **`ctx.authz` is a public service of `core.authz`**, reached by other modules as
  `ctx.deps['core.authz']`. The kernel gets no new port for it. The one kernel addition is read-only
  `ctx.permissions` (the permissions the loaded manifests declare), because an authorisation module
  cannot know them otherwise; any module may read it.
- **Roles are data; Admin is resolved, not copied.** Admin holds every declared permission at check
  time, so a permission of a module added later reaches Admin without a data migration. Other roles
  hold stored permissions. A stored permission that no loaded manifest declares is logged and
  ignored, never granted, and cannot be stored in the first place.
- **Default permissions come from a registry** (`authz.defaultRole`), so modules give Reviewer or
  User their permissions without editing `core.authz` (CLAUDE.md rule 7). Defaults are applied once
  per role and permission; an administrator who removes one does not see it come back at the next
  start.
- **Resource policies** are a registry (`authz.resourcePolicy`) for permissions that declare a `scope`.
  A policy can only add access to a resource; it can never override a built-in protection.
- **Built-in protections live in the service layer**, not in routes: nobody changes their own roles,
  nobody approves their own request, and the last Admin cannot be removed. They hold for every caller
  including Admin.
- **Cache.** The permissions of a user are cached in process for 5 seconds and the cache is emptied
  when a role changes in that process. As for sessions (ADR-0007), another process learns of a change
  when its entry expires, so with several server processes a demoted user keeps access there for at
  most 5 seconds. Writes inside the authz service decide from the database, not from the cache.

### The bootstrap exception to CLAUDE.md rule 3

- Rule 3 forbids touching another module's tables. M3 needs one exception: a single migration in
  `core.identity` (it runs after `core.authz`) copies every user with `is_bootstrap_admin = true` into
  `authz_role_assignment` with the Admin role and then drops the column, in one transaction
  (ADR-0006, "`identity_user.isBootstrapAdmin`"). It is implemented in sprint 2 (`0006_bootstrap_admin_to_authz.sql`; ADR-0015 records the rest of that sprint) and recorded here.
- It is the **only** place in the repository that touches a foreign table. A test asserts that no
  other migration or source file references a table of another module.
- With zero marked users the migration changes nothing; `scorpion create-admin` and the first-run
  token still work.

## Consequences

- `core.identity` gains a dependency on `core.authz` in sprint 2. Until then identity does not use
  authz, and a user without roles gets 403 everywhere that is not public, as in 0.3.0.
- Authz cannot tell whether a user still exists. "Last Admin" counts assignments, so a deactivated
  Admin still counts until sprint 2's purge removes the assignment.
- Anonymous callers of non-public routes get 401 instead of 403 once `core.authz` is in a profile.
- Because a permission id must be declared by a loaded manifest to be stored, removing a module from a
  profile leaves its stored permissions inert (logged, never granted) rather than breaking start-up.
