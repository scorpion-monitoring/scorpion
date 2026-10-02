---
'scorpion': minor
---

Roles now work. Approving an account gives it a role, and a signed-in person can use their own account: this is the first
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
