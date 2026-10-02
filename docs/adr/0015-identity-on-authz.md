# ADR-0015: Identity on authz: role routes, token scopes and the system caller

- Status: Accepted
- Date: 2026-10-02

## Context

ADR-0014 made `core.identity` depend on `core.authz`. Sprint 2 of M3 connects them: identity asks authz for every
decision, gives roles at approval, owns the role routes and bootstraps the first administrator. Four questions had no
answer in ADR-0006, ADR-0008 or ADR-0014:

1. What is a token scope, so that "scope ∩ owner's permissions" means something? ADR-0008 fixed only the shape
   (`read:kpi`), not the meaning, and no permission has a `read:`/`write:` form.
2. Who guards a role change: identity's permission, authz's, or both?
3. How does a call with no human caller (`scorpion create-admin`, the first-run token, an account that a policy
   activates) give a role without weakening the rules for people?
4. What does approving an account give, and what do the other roles get from identity?

## Decision

### Token scopes are permission ids

- A scope is the id of a permission (`core.identity.me.read`), compared exactly: no prefix, wildcard or case folding.
  Supersedes the `read:<resource>` / `write:<resource>` shape of ADR-0008 (answered by the owner of the repository on
  2026-10-02).
- **Effective permission = scope ∩ the permissions of the owner.** The authoriser in `core.authz` (the route) and
  `require`/`can` (the service) allow a token actor only a permission that its scopes name **and** its owner holds. The
  scope gate also covers resource policies. A session has no scopes and is not limited by them.
- A token with no scopes can do nothing, so creating one needs **at least one** scope, and every scope must be a
  permission that a loaded module declares (422 otherwise). A scope that names a permission the owner lacks is
  accepted and grants nothing: the owner may be promoted later, and the scopes stay the ceiling.
- Tokens made in 0.3.0 have `read:kpi`-shaped scopes. They match no permission and grant nothing (fail closed); the owner
  makes a new token. 0.3.0 was not usable in production (ADR-0005), so no migration rewrites them.
- A role taken from the owner takes effect for the token like for the owner: at once in the process that made the
  change, within the 5 second cache bound in another (ADR-0014).
- Tokens still cannot manage tokens or the profile, password, e-mail and OIDC link (session-only routes, 403 whatever
  the scopes). Ending the owner's own sessions (`POST /auth/logout-all`) is allowed to a token only with a scope for
  `core.identity.session.manage`, which is the M2 behaviour made subject to scope.

### Two permissions guard a role change

- The role routes (`GET /roles`, `POST /users/{id}/roles`, `DELETE /users/{id}/roles/{role}`) declare
  `core.identity.role.read` / `core.identity.role.assign`, and the identity service checks them again. The identity
  service then calls `AuthzService`, whose methods check `core.authz.role.read` / `.assign` themselves.
- Reason: identity decides who may administer **users**; authz decides who may change **roles**, for every caller,
  including jobs and modules that never go through identity's routes. Neither check can be forgotten by the other
  layer. Admin holds both pairs; a custom role needs both. The cost is that granting "role administrator" means two
  permissions; the role editor lists both.
- The built-in protections stay in authz and hold for Admin: nobody changes their own roles, the last Admin stays.

### Approval gives the role, in one transaction

- `POST /users/{id}/approve` takes an optional `{ role }` (default `user`). The status change, the assignment and the
  events are one transaction (authz's `assignRole`, called inside identity's `ctx.db.tx()`, joins it as a savepoint). A
  refusal anywhere (unknown role, an approver without `core.authz.role.assign`, a failing outbox) leaves the account
  pending with no role.
- The approver therefore needs `core.authz.role.assign` as well as `core.identity.user.approve`. Admin has both; a
  role that may only approve cannot approve. Rejecting needs no role.
- Nobody approves or rejects their own account: identity passes `{ approval: true, requestedBy }` to
  `AuthzService.require`, which refuses before anything else, Admin included.
- An account that an approval policy makes active at once (registration, first OIDC sign-in) gets the default role in the
  transaction that creates it.

### What the roles hold from identity

- **User** holds the self-service permissions of this module: `me.read`, `session.manage`, `profile.read`,
  `profile.update`, `password.change`, `email.verify`, `auth-method.link`, `token.read`, `token.manage`. They come
  from the registry `authz.defaultRole`, are applied once, and can be taken away by an administrator.
- **Admin** holds everything by resolution. **Reviewer gets nothing from identity**: its permissions come from the
  modules that review things (M6 and later).
- `core.identity.token.manage-any` lets a holder revoke the token of anyone (route `DELETE /tokens/{id}`). It does not
  list or rotate someone else's tokens: a rotation shows the new secret to the caller.

### The system caller

- There is **no `Actor` of kind `system`**. The `Actor` type stays `anonymous | user`, so no route, header or
  authenticator can produce a caller that bypasses authz.
- Three methods of the public authz service are for trusted code with no human caller and check no permission:
  `assignRoleAsSystem(tx, …)` (assignment with `assigned_by` null and an event with actor `null`; it never removes a
  role), `removeAllAssignments(tx, userId)` (the purge, ADR-0014) and `hasHolders(roleKey, tx?)` ("no administrator
  yet"). They take the caller's transaction, so their effect commits or rolls back with the write that needs them.
- The trust boundary is the profile's module list, as for contributing to `kernel.authorizer` (ADR-0005): a module that
  depends on `core.authz` can call them, like it could write the table. The self-change and last-Admin rules concern
  human callers and removals; the system only adds roles.
- "No administrator yet" means "no user holds the Admin role". The bootstrap migration, the Admin role it creates when
  `core.authz` has not seeded it yet, and the removal of `is_bootstrap_admin` follow ADR-0014.

### Events

`core.authz` emits `authz.role.assigned@1` and `authz.role.removed@1` (`userId`, `roleKey`, `actorId` or `null`) in the
transaction of the change. `identity.user.approved@1` gains `role`, and `identity.token.revoked@1` gains `revokedBy`.
Nothing holds a secret. No module subscribes yet; M4's audit trail does.

## Consequences

- Role changes made inside a larger transaction invalidate the permission cache before the outer commit. A request that
  races with it can refill a stale entry for up to the 5 second TTL, the documented bound (backlog).
- `scorpion create-admin` and the first-run token no longer write a marker; an instance with users but no Admin shows the
  first-run token at start, which is the point.
- Every module that adds a route adds a decision to the matrix of `defect-01.privilege-escalation.test.ts`, or its tests
  fail.
- Changing `core.identity.role.assign` alone, without the authz permission, does not let anyone assign a role: the
  error is a 403 from authz, and the route table does not show it.
