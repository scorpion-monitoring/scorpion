# ADR-0036: service access: the policy `service.member`, three groups, the slug history

- Status: Accepted (part 1: sprint 2; part 2, the anonymous reads: sprint 3)
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

### Publication (the part of the flag that sprint 2 builds; the anonymous reads it enables are part 2 below)

`PUT /services/{id}/publication` with `{ public: boolean }` sets `public`, `published_at` and `published_by` together under the row lock. Setting
the state the service already has is a 200 without an event; a publication while `service.allowPublic` is off is a 409. The anonymous reads
that the flag enables are part 2.

## Part 2: the anonymous reads (M7 sprint 3)

Context: [m7-sprint-plan.md](../m7-sprint-plan.md) §3 and §7, Decisions 4, 6, 8, 15, 16 and 17. This is the first time the product
answers a request without a caller for data that belongs to one record, so the rules below are the security claim of the milestone.

**The prototype.** [`public-routes-prototype.test.ts`](../../apps/server/src/public-routes-prototype.test.ts) ran first, behind the real pipeline
and a real database. It showed, with **no change in a scoped path** (`apps/server/src/pipeline`, `packages/contracts/src/route.ts`,
`modules/core-identity`, `modules/core-authz`): (1) the rate limit of the `default` group applies to a `public: true` route (the bucket is charged
before authentication, anonymous or not); (2) a record that is not public answers 404 with exactly the body of an unknown id (the problem is
built by the error mapper from one `NotFound`; only the per-request `requestId` differs), never 403; (3) a route sets `Cache-Control: public,
max-age=60` itself through the response headers, and the 404 carries none; (4) the server keeps no copy, so an unpublish is a 404 at the next
request; (5) a session cookie, a stale cookie or a bad bearer token on a public route changes nothing and sets no cookie (an authentication
failure on a public route means "not signed in", as the pipeline already documents); (6) the strict CSP (`default-src 'none'`) is on every
answer, and the JSON-LD is served with no `<`, `>` or `&` in it. The page side (the block in `<svelte:head>`, with the web app's CSP) was proved in M6
(ADR-0033) and is unchanged: a script of type `application/ld+json` is a data block and needs no allowance.

**What is public, and when.**

- A **service** is public only while its flag `public` is set (only Reviewers and Admin set it, part 1) **and** the setting `service.allowPublic`
  is on. `GET /public/services/{ref}` and `…/schema-org` take an id, a slug or an old slug.
- An **organisation** is public only while a public service names it as its provider or a consortium (Decision 8). The question "is it named by
  a public service?" must not make `registry.organisations` depend on `registry.services`, so it goes through a registry: **`org.publicReference`**,
  declared by `registry.organisations`, with entries `{ id, list(organisationId) → [{ id, slug, name }] }` that list the public records that
  name the organisation. `registry.services` contributes one (the public services of the organisation by the roles `provider` and `consortium`,
  empty while `allowPublic` is off). This was chosen over extending `org.usage`: usage counts every reference and blocks a delete (a private
  service counts), public reference lists only public ones and opens a read, and one entry shape for both would let a contributor answer the wrong
  question. The organisation's public record shows the list as `services`, so the rule and the page use one read. The registry is asked at every
  request and nothing is cached.
- Nothing else is public. Routes are `GET` only.

**One answer for "no".** The public service routes answer `undefined` from the service for a private service, an unpublished one, `allowPublic` off,
an unknown id or slug, an empty ref and one that is too long; the route turns `undefined` into one `NotFound` with one text, so the body is the
same for all of them. The organisation routes do the same, and an id that is no UUID is a 404 (the path parameter is a plain string, not `z.uuid()`,
which would be a 422 that tells a probe the shape of the id). A 403 is never used on a public address.
The one difference an anonymous reader can still see is between the service routes and the organisation routes (different texts), which names the
kind of thing asked for, not whether it exists.

**The flag is read with the record.** The record, its organisation links and its configured values come from **one SQL statement** (subselects),
so they share a snapshot: a publication racing a read gives a whole record or a 404, never a record without its provider. The statement
names its tables outright, because Drizzle leaves the table off a column of a single-table query and an unqualified `id` inside a subselect would
be the subselect's own (a test with a read by id caught exactly this). The organisation names are read after, from `registry.organisations`.

**Separate, pinned records.** The public service record has the fields `id`, `slug`, `name`, `logoUrl`, `description`, `url`, `sameAs`, `license`, `stage`,
`provider` and `consortia` (each `{ id, name, public }`), and the public organisation record `id`, `name`, `abbreviation`, `logoUrl`, `description`, `website`,
`rorId`, `sameAs` and `services` (each `{ id, slug, name }`). They are their own Zod schemas and the routes copy the fields one by one; they never are the signed-in
record with fields removed. `public` in an organisation reference is constantly true (Decision 8 makes an organisation of a public service public) and
is kept for the page's links. `id` is in both records although the plan's list omitted it: the page, the profile's `@id` and the links need it. No
contact point, `editableFields`, `allowedActions`, configured value, member, audit column or `published_*` is in either. `apps/server/src/public-records.test.ts` compares
the property names of the live response schemas, at any depth, with a list; it fails on an added field and on any private name in a public route's answer.

**The profile.** `service/schema-org.ts` is one pure builder for the signed-in route, the public route and the page (plan §3). `@id` is the id URL and
survives a rename; the stage and the contact point are never mapped; the organisation nodes come from the organisation's own profile built **without** the
contact point; a configured field maps to one of four properties; other modules add `serviceType`, `category`, `audience`, `areaServed`, `termsOfService`,
`slogan` and `serviceOutput` through `service.profileContributor`, and anything else a contributor returns is dropped and logged, so it can never overwrite
`@id`, `@type`, `name`, `provider` or `license`; a contributor that throws is skipped. The result is turned into a string only by `serializeJsonLd` (one escape
function, `registry.organisations/public`). `license` is not a property of schema.org `Service`; it stays because the plan asks for it, and the vocabulary test
names it as the one documented exception (backlog).

**The cache lifetime.** A 200 says `Cache-Control: public, max-age=60`. It is a constant, not a setting. The server keeps no copy, so the delay before an unpublish
is seen is zero for a client without a cache and at most 60 seconds for a shared cache in front of the instance; operators who cache these routes must know it
(changeset, README). `service.allowPublic` off needs no cache lifetime to wait for on the server and is the instance's off switch; a cached 200 can still be
served for up to a minute.

**The one audited `{@html}` moves** to `packages/ui-kit/src/JsonLd.svelte` (Decision 15) so both modules use one file. The ESLint override names exactly
that path; `tools/eslint-plugin/test/ui-rules.test.ts` and `apps/web/src/safe-html.test.ts` prove nothing else may use `{@html}`. ui-kit cannot import
`registry.organisations`, so the component's input is the **string** that `serializeJsonLd` returns, and it checks it again: it throws on a string that holds `<`,
`>`, `&`, U+2028 or U+2029, or is not JSON. `apps/web/src/json-ld.test.ts` keeps every hostile-input case and adds the refusals.

**The notice** (plan §7 item 6; trimmable, built). Making a service public or private writes, in the same transaction as the flag and the event, an inbox item and,
where there is an address and the category `registry-service` is on, a mail to the approved managers of the provider and the creator of the service, read at that
moment, never to the person who decided, only for active accounts. It names the service and the new state and carries the page link; it names nobody and no address
beyond the recipient's own. A rollback sends nothing.

### Consequences of part 2

- Every public address is a `GET`, is rate limited, answers one 404, carries no person and no contact point, and is listed in the route table with its reason; the
  four routes under `/public` are the exact set a test expects, so a new public route is a conscious change.
- `registry.organisations` gained a registry and one trusted read (`listApprovedManagerIdsAsSystem`) and learned nothing about services.
- An operator who sets `service.allowPublic` to off ends every anonymous read at once, without unpublishing; a later switch on restores them.
- A shared cache can show a service for up to a minute after an unpublish. The plan accepts it; a `no-store` mode would be a setting (backlog).
- The V8 chapter (8.2.1, 8.2.3, 8.3.1) carries the claims with tagged tests; no file in a scoped path changed.

## Consequences

- A delegated route and its service are one security unit; the matrix rows, the service tests with a denied case per group and the V8 tagged
  tests keep that honest. No file in a scoped path changed.
- The provider is the only owner. A service with no provider cannot exist (`min: 1`), so the policy never has a service nobody owns.
- Moving a service between providers changes at once who may edit it; a manager can hand a service only to an organisation they manage.
- The identity fields are a code table (`IDENTITY_FIELDS`), not configuration: a field a deployment adds is an `edit` field.
