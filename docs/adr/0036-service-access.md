# ADR-0036: service access: the policy `service.member`, three groups, the slug history

- Status: Accepted (part 1; part 2, the publication flag and the anonymous reads, is written with sprint 3)
- Date: 2026-10-12

## Context

M7 sprint 2 decides who may do what to a service ([m7-sprint-plan.md](../m7-sprint-plan.md) §6, Decisions 5, 6, 12, 14, 16, 18, 19).
It is the second module with a resource policy and the first record with **three groups** of writers on one resource. It reuses the
pattern of [ADR-0034](0034-scoped-permissions-at-the-route-and-delegation.md) (a plain permission on the route, the scoped check in the
service) and the field-rules table of [ADR-0033](0033-organisation-model.md); the tables, the slug rules and the registries are
[ADR-0035](0035-service-model.md).

**The prototype of the first hours** ([`access-prototype.test.ts`](../../modules/registry-services/service/access-prototype.test.ts) and
[`defect-01.service-routes-prototype.test.ts`](../../apps/server/src/defect-01.service-routes-prototype.test.ts)) asked whether the policy
can carry the three groups through the real authoriser, by session and by token, with a demotion read at the next call, and whether a
delegated `PATCH` that carries only the plain `…service.read` can be reached by a plain User and refused by the service. Both held, with
**no change in a scoped path** (`modules/core-authz`, `modules/core-identity`, `apps/server/src/pipeline`, `packages/contracts/src/route.ts`):
the policy is a registry contribution, the route an ordinary `createRoute()`. A token passes only for the scopes it names and only for what
its owner holds; a manager demoted a moment before is refused at the next request. The `scoped` route flag stays deferred (Decision 12).

## Decision

### The policy `service.member`

Contributed to `authz.resourcePolicy` for the resource type `service`. For a request `{ actor, permission, resource: { type: 'service', id } }`
it loads the service's **provider** (the organisation that holds the role of the registry `service.orgRole` that owns a service) from the
module's own table and asks `registry.organisations` through its `public.ts` (`isApprovedMemberAsSystem`, `isManagerAsSystem`) **at every
call**. Nothing is cached, so a removal, a demotion or a move of the service to another provider is seen at the next call (the window of
ADR-0034, one request, applies). The policy only adds access; the built-in protections of `core.authz` run before it.

| Permission              | Scope     | Admin  | Approved manager of the provider | Approved member of the provider | Others                                            |
| ----------------------- | --------- | ------ | -------------------------------- | ------------------------------- | ------------------------------------------------- |
| `service.read`          | plain     | global | global (role `user`)             | global                          | global                                            |
| `service.create`        | plain     | global | role `user`                      | role `user`                     | role `user`; the service adds the membership rule |
| `service.manage`        | plain     | global | no                               | no                              | no                                                |
| `service.publish`       | plain     | global | no                               | no                              | Reviewer: global                                  |
| `service.edit`          | `service` | global | yes                              | yes                             | no                                                |
| `service.edit-identity` | `service` | global | yes                              | no                              | no                                                |
| `service.read-contact`  | `service` | global | yes                              | yes                             | no (the setting decides)                          |

A requested, rejected or left membership grants nothing, and neither does a membership of another organisation, of a consortium or of
another service's provider. Only the **provider** counts.

### Three groups on one record

- **Members** of the provider (`service.edit`): name, licence, stage, description, URL, `sameAs`, the contact point, the icon, the consortia and the
  configured fields.
- **Managers** of the provider (`service.edit-identity` as well): the **slug** and the **provider**. A manager moves a service only to an
  organisation they also manage (403 otherwise); Admin is never restricted.
- **Admin** holds every permission by resolution (`service.manage` among them).
- **Reviewers and Admin** alone set the publication flag (`service.publish`); a manager or a member sees `public` in the record and cannot change it.

One `update` method and one icon path serve all groups, driven by `service/field-rules.ts`: `requiredAccess(fields)` returns `identity` for the
slug and the provider and `edit` for every other field; a mixed request needs both; `allows(level, needed)` decides; `editableFields(level, keys)`
draws the same line for `GET /services/{id}`, together with `allowedActions` (`edit`, `publish`, `unpublish`). A request that names a field its
caller may not write is **refused whole** with a 403 that names the fields and never a value; nothing is written and no event is sent. The
order is 404 (a service is readable by every signed-in person, so it reveals nothing), 403, then 422, so a caller who may not edit learns
nothing from the validation. **Creating** needs `service.create` (Admin and User) **and** Admin or an approved member of the chosen provider
(Decision 14): no membership, no service, and the check runs before the body is parsed. The routes carry the plain `…service.read`
(`PATCH`, the icon routes) or the plain `…service.create` / `…service.publish`; the service is the authorization, and the defect-1 matrix
expects 403 from the service for a plain User on each delegated row.

### The slug and its history

A rename is an `update` that names `slug` and needs the identity access. In one transaction (the service row is locked) it writes the new
slug to the row and to `svc_slug_history`; the old slug stays in the history, so it keeps resolving (`redirectedFrom`) and is never given to
another service. A slug the service already holds in the history (a return to an old one, or a change of case) is reused, not inserted again.
Two writers racing for one slug, two renames or a rename and a create, are decided by the unique index on `lower(slug)` of the history: one
wins and the other gets **409 `slug-taken`** naming the field only. The event `registry.service.slugChanged@1` carries ids only.

### Events and audit

`registry.service.updated@1` `{ serviceId, fields, by: 'admin' | 'manager' | 'member', actorId }` holds the field **keys** that changed, never a
value; `by` is `admin` when the caller holds `service.manage`, `manager` when the request needed the identity access, else `member`. A no-op sends nothing.
`slugChanged`, `published` and `unpublished` carry ids. `core.audit` logs the last three as **critical** (a new slug changes an address that others
link to; publication changes who can read the service at all) and `updated` and `created` as ordinary admin events.

### Publication (the part of the flag that sprint 2 builds)

`PUT /services/{id}/publication` with `{ public: boolean }` sets `public`, `published_at` and `published_by` together under the row lock. Setting
the state the service already has is a 200 without an event; a publication while `service.allowPublic` is off is a 409. The anonymous reads
that the flag enables are part 2.

## Consequences

- A delegated route and its service are one security unit; the matrix rows, the service tests with a denied case per group and the V8 tagged
  tests keep that honest. No file in a scoped path changed.
- The provider is the only owner. A service with no provider cannot exist (`min: 1`), so the policy never has a service nobody owns.
- Moving a service between providers changes at once who may edit it; a manager can hand a service only to an organisation they manage.
- The identity fields are a code table (`IDENTITY_FIELDS`), not configuration: a field a deployment adds is an `edit` field.
