# ADR-0034: scoped permissions at the route, and the first delegated role

- Status: Accepted
- Date: 2026-10-09

## Context

M6 is the first module whose rights belong to people **inside** a resource: an approved manager of an organisation decides
membership requests, changes roles and removes plain members of that organisation, and edits its descriptive fields (sprint 4). The
authorizer of `core.authz` already supports a permission that declares a `scope` and a resource policy that answers for it
(ADR-0014, ADR-0015). One question was left open in the backlog ("decide it with the first resource policy"): the authorizer checks
the permission of a **route** without a resource. A route that names a scoped permission therefore denies a caller who holds it only
through the policy, a manager, before the policy is ever asked.

The sprint-3 prototypes ([`delegation-prototype.test.ts`](../../modules/registry-organisations/service/delegation-prototype.test.ts)
and [`defect-01.delegated-routes-prototype.test.ts`](../../apps/server/src/defect-01.delegated-routes-prototype.test.ts)) were written
before the state machine. They show:

1. A resource policy that answers per permission (a member views, only a manager decides or manages roles) works through the real
   authorizer with an approval resource, a session and a token, **with no change in `core.authz`**. A token passes only for a scope it
   names and only for what its owner holds through the policy; a demotion is read at the next call.
2. **Design A** (the route names a plain global permission that every signed-in person holds, the service calls
   `authz.require(actor, scoped, resource)`) lets the manager of one resource through and nobody else, with no change in the pipeline
   or in `createRoute()`. **Design B** (the route names the scoped permission) answers 403 to a manager and 200 to Admin only.

## Decision

### Scoped permissions: the route carries a plain permission, the service is the authorization

A delegated route names the plain `registry.organisations.organisation.read` (held by the role `user` and by Reviewer). The service
then calls `ctx.authz.require(actor, '<scoped permission>', { type: 'organisation', id, … })`, which consults the policy
`organisation.member`. **The service is the authorization**: a delegated route without a service check is a defect, and the matrix of
`defect-01.privilege-escalation.test.ts` has a row for every delegated route that expects 403 for a plain User, which proves the
service answer and not the pipeline. The route table of `authorization.md` carries a note on these rows.

No file in a scoped path changes: `modules/core-authz/**`, `modules/core-identity/**`, `apps/server/src/pipeline/**` and
`packages/contracts/src/route.ts` are as before.

**The alternative, recorded and deferred.** A `scoped: true` flag on `createRoute()` would let the pipeline pass a caller who lacks
the permission globally, with the service re-check as the guard. It needs a change in `packages/contracts/src/route.ts` and in
`apps/server/src/pipeline/**`, both ASVS-scoped (V8 evidence and tagged tests would have to move in the same pull request). It is
built in M7 only if `service.edit` cannot use design A. The cost of design A that remains is the one above: the pipeline cannot tell
a delegated route from an ordinary read, so the tests, not the pipeline, prove the service check.

### The first delegated role: the organisation manager

A membership has a role, `member` or `manager`, and the role is a property of an **approved** membership of **one** organisation. A
manager of A has no right on B. The policy reads the caller's approved membership of `resource.id` from the database on every call
(no cache), so a removal or a demotion takes effect at the next call.

| Action (scoped permission)                                     | Admin                 | Manager of that organisation | Approved member                         | Others  |
| -------------------------------------------------------------- | --------------------- | ---------------------------- | --------------------------------------- | ------- |
| view members (`membership.view-members`)                       | global                | yes                          | yes, while `membersVisibleToMembers` on | no      |
| decide a request (`membership.decide`)                         | global                | yes, never their own request | no                                      | no      |
| promote or demote (`membership.manage-roles`)                  | global                | yes, never their own role    | no                                      | no      |
| remove a member (`membership.remove`)                          | global, a manager too | yes, a **plain member** only | no                                      | no      |
| read the contact point (`organisation.read-contact`)           | global                | yes                          | no (the setting decides)                | no      |
| edit the descriptive fields and the logo (`organisation.edit`) | global                | yes                          | no                                      | no      |
| request, withdraw, leave (`membership.request`, plain)         | own row               | own row                      | own row                                 | own row |

"Admin: global" means the caller holds the permission through a role (Admin holds every declared permission); the service tells an
Admin from a manager by asking `authz.can(actor, permission)` **without** a resource, which never consults the policy. A rejected,
requested or left row grants nothing. The policy only adds access; it cannot override the `approval` rule, which `core.authz` checks
first.

**A caller who may act nowhere.** A delegated action on a membership id loads the membership, and an unknown id is a 404. A plain
User must not see that difference (the defect-1 matrix expects 403 on every delegated row, with ids that exist nowhere), so the
service first checks that the caller may act on memberships at all: an Admin (holds `membership.decide` globally) or a manager of
at least one organisation. Anyone else is 403 before anything is looked up. A manager who names a membership of **another**
organisation gets 403 after the load (the scoped check); a manager who names an unknown id gets 404. Membership ids are UUIDv7 and are
shown only to those who may see the row, so the difference tells a manager nothing they could use.

### What cannot be delegated

- **Nobody approves or rejects their own request.** The service passes `approval: true` and `requestedBy` on every decision path;
  `core.authz` denies it before roles and policies, Admin and managers included. A manager who has also asked to join another
  organisation cannot decide that request either.
- **Nobody changes their own role.** `setRole` throws `Forbidden` when the target membership's user is the caller, whatever roles the
  caller holds: a manager cannot promote or demote themselves, and an Admin who is a member cannot make themselves manager. Another
  Admin or manager can.
- **Nobody removes themselves.** That is `leave`. An Admin who is a member is bound by it.
- **A manager never removes another manager.** Only an Admin does (Decision 16). To end another manager's role a manager can only
  demote them (Decision 18), a separate, audited and announced act.
- **Creating and deleting organisations, and `type`, `abbreviation`, `name`** stay with Admin (Decision 14). A manager who names one of the three in an edit is refused whole (403, field names only).

### The last manager

The last manager may leave, be demoted (by an Admin or by another manager; never by themselves) or be purged. Nothing blocks it. The
organisation then **has no manager and falls back to administrators**: requests are decided and announced by Admins only until someone
is promoted. The event carries `organisationHasManager: false`, and an inbox item (category `membership`, no mail) goes to the
administrators.

### Serialising changes

Every state or role change locks the membership row (`select … for update`) inside its transaction, re-reads the state **and the
role** under the lock, and only then decides, so a second caller sees the new state: a decision answers `409 membership-state`, a role
change to the role the row already has answers `200` (idempotent), and a member promoted a moment before cannot be removed by a
manager any more.

A rule that spans rows is the number of managers of one organisation (the limit on a promotion, and `organisationHasManager` after a
demotion, a leave, a removal or a purge). Two such changes on two different rows would each count the other as still a manager. They
take a transaction-scoped advisory lock on the organisation (`pg_advisory_xact_lock`, keyed on the organisation id) **after** their row
locks and before they count. The order is always row locks first, then the advisory lock; the advisory lock is never held while a row
lock is awaited, so no cycle can form. A lock on the organisation row itself was not chosen because the deletion of an organisation
takes that row first and then the membership rows, the opposite order.

### The window after a demotion

The permission is checked (scoped `require`) before the row is locked, so a decision that passed the check when a demotion committed a
moment later is allowed **once**: the window is one request. The next call is denied, because the policy reads the database each time
(prototype test and `policy.test.ts`). Closing the window would mean taking the lock before the permission check, which would let an
unauthorised caller queue behind a lock; the price of one already-authorised request was judged lower.

## Consequences

- A delegated route and its service are one security unit. The matrix rows, the service tests with a denied case and the V8 tagged
  tests (`v8-authorization.yaml`, 8.2.1, 8.2.2, 8.3.1) keep that claim honest.
- M7 can use the same pattern for `service.edit` (the policy `service.member` reads the module's own membership reads).
- If design A ever proves wrong for a route that must be reachable by a person who holds nothing globally, the `scoped` flag is the
  documented way out, with its own ADR and the V8 evidence in the same pull request.
