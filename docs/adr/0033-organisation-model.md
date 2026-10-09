# ADR-0033: the organisation model

- Status: Accepted (the Schema.org profile, the logo and the contact point were completed in sprint 2 and membership in sprint 3; the two editor groups and the JSON-LD block are finished in sprint 4)
- Date: 2026-10-09

## Context

FEATURES §3.4 describes two tables (providers and consortia). The architecture asks for one `organisation` table typed by a registry
entry. M6 builds it ([m6-sprint-plan.md](../m6-sprint-plan.md)); M7 (services) and M8 (public API) read it; M13 imports into it.

## Decisions

### Table prefix and ownership

The module `registry.organisations` sets `tablePrefix: 'org_'` (ADR-0004), as `core.audit` does with `audit_`. Tables are
`org_organisation` and `org_membership`. User ids and the logo's blob id are plain columns without a foreign key,
so a purge or the blob cleanup cannot be blocked. No pg enum: the check constraints and the registry carry the closed sets.

### One table, typed by a code registry

`org_organisation.type` is plain text, checked against the registry `org.type` in the service. An entry is
`{ id, labels: { en, de? }, membership, schemaType?, order }`. It is a **code registry, not a vocabulary**: a type carries behaviour
(`membership`, `schemaType`) and M7 depends on it. The module contributes `provider` and `consortium` (both `membership: true`);
another module may contribute `funder` without editing this one. A stored organisation whose type is no longer registered is still
listed and readable with `typeKnown: false` and cannot be written to until the type is back.

### `org.usage`

A second registry, `{ id, count(tx, organisationId) }`, with the contributing module's id as `id`. Deleting an organisation and
changing its type ask every entry; a count above zero is `409 organisation-in-use` naming the module ids, never the rows. M7
contributes the entry for `service_organisation`. Without a contributor nothing blocks.

### Fields, uniqueness and the lookup key

Fields: type, abbreviation, name, plain-text description, website, `sameAs` (list of `http(s)` URLs, at most 20), ROR id (stored as
the bare id), contact point (`contact_email` and `contact_type`, set together), logo. Name and abbreviation are unique per type,
case-insensitively; a ROR id names one organisation. **The abbreviation, not the name, is the lookup key** for M7 and M8
(`findByAbbreviation(type, abbreviation)`): it has a fixed format (no whitespace or `/`), is short, is stable in URLs and in legacy
data, whereas the name is free text that organisations reword. Hierarchy (`parentOrganization`) is not modelled.

### Schema.org profile

One pure function maps the record to a schema.org `Organization` (mapping table in the sprint plan, §3); the API route, the detail
page and later the public API use only that function (`toSchemaOrg`, in `service/schema-org.ts`, takes the origin and the base path as
arguments). Properties without a value are omitted.

The profile has a dedicated route, `GET /organisations/{id}/schema-org` (`application/ld+json`), not content negotiation on
`GET /organisations/{id}`: `createRoute()` declares one media type per response, and the OpenAPI document, the typed client and the
response walker are built from that. The route needs `…organisation.read` (every signed-in person, no anonymous access in M6) and
answers `Cache-Control: private, no-cache`, because the contact point depends on the reader. `createRoute()` expresses the media type
as the route of the audit CSV does; nothing changed in `packages/contracts`.

`serializeJsonLd(value)` is the only function that turns the profile into a string: `JSON.stringify`, then `<`, `>`, `&`, U+2028
and U+2029 are written as `\uXXXX`. The output has no `<` (so no `</script>`, `<script` or `<!--`), is valid JSON and parses back to
the same value; a lone surrogate is already escaped by `JSON.stringify`. The route uses it too, so the API answer and the page block
cannot differ.

**The block on the detail page (Decision 17).** The page's server load calls the profile route through the typed client with the
visitor's session, so the contact point is in the block exactly when the route includes it. One component, `ui/JsonLd.svelte`, puts
`serializeJsonLd(profile)` into `<svelte:head>` with the module's only `{@html}`; the tags around it are constants and the serialised
text is its only variable input. The ESLint exception for `svelte/no-at-html-tags` names exactly that file (a `files` override in
`eslint.config.js`); every other file keeps the rule, and a test lints a fixture to prove it. A `<script type="application/ld+json">`
is a data block: the browser never runs it, so the CSP (`script-src 'self'` with nonces, no `unsafe-inline`) needs no allowance and the
block carries no nonce.

**Prototype result (sprint 4, day 1).** The shell's catch-all route (`routes/[...path]`) renders a module page on the server: the page's
`load` runs on the server (`+page.server.ts` → `loadPage`), the component is imported in `+page.ts`, and SSR collects its
`<svelte:head>` into `%sveltekit.head%`. Checked two ways: a unit render of `JsonLd.svelte` with `svelte/server` puts the block into
`head` and nothing into `body`, and a Playwright run against the built web app and the real API (name
`</script><script>window.pwned=1</script> <!-- & …`) finds the block in the server's HTML, parses to the exact name, executes nothing,
and reports no CSP violation. So the `transformPageChunk` fallback of the plan is not needed, and `apps/web` stays unchanged.

### Logo

A module stores an image through its own route, its own permission and the blob service of `core.blob`; `POST /files` and
`core.blob.manage` stay for the branding logos; nothing changed in `core.blob`. `PUT` and `DELETE /organisations/{id}/logo` take the
raw image (`maxBodyBytes` is the ceiling of `core.blob`, `rateLimit: 'strict'`, audited) and need `…organisation.manage` (sprint 4: the
scoped `…organisation.edit`, checked in the service). The service checks the permission first, so a denied caller leaves no file,
then calls `blob.put` (re-encoded raster or sanitised SVG, else 422), then in one transaction sets `logo_blob_id` and `logo_hash`, calls
`blob.setReference('registry.organisations:logo:<organisation id>', blobId)` and emits `registry.organisation.updated@1` with the
field name `logo`. If that transaction fails the new file is unreferenced and the hourly cleanup removes it after the grace period
(ADR-0018). A replacement releases the old file through `setReference`; deleting the logo or the organisation releases the reference
in the same transaction. The same image again changes nothing and emits nothing. `GET /organisations/{id}` shows `logoUrl`
(`<base path>/api/internal/files/{hash}`); the module never serves bytes, and the logo is public by its hash.

### Contact point

The contact address is the organisation's role address, not a user's address; it belongs to no account and is never a mail recipient.
It is read by administrators and the organisation's managers always, and by other signed-in persons when the setting
`organisation.exposeContactPoint` is on (default on). It is never in a list row, an event, an audit entry, a log line or a mail, and
the trusted reads of the public service never return it (`toSchemaOrgAsSystem` has `includeContact: false` by default).

The check is `ctx.authz.can(actor, 'registry.organisations.organisation.read-contact', { type: 'organisation', id })`, then the
setting. The permission is declared with the scope `organisation` (a manifest field, no sprint 3 machinery): Admin holds it by
resolution, nobody else by default, and the `organisation.member` policy of sprint 3 adds the managers, so sprint 3 changes no
service code. _Sprint 4 adds the field table in `authorization.md`._

### Two editor groups and the field rules per role

The record has two editor groups. An Admin edits every field and alone creates and deletes organisations. The managers of an
organisation (sprint 3) edit `description`, `website`, `sameAs`, `rorId`, `logo` and the contact point of their own organisation, never
`type`, `abbreviation` or `name`: those identify the record (membership, `org.usage`, `@type`, the lookup key, the name shown by
services). There is one `update` method and one logo path; a pure field-rules table (`service/field-rules.ts`) maps a set of fields to
the access it needs (`admin` or `edit`), so the second group adds a policy answer, never a second code path. A request that touches a
field its caller may not write is refused whole (403). No review step for manager edits in M6 (Decision 19).

### Membership

One row per person and organisation in `org_membership`, with a **state** (`requested`, `approved`, `rejected`, `left`) and a **role**
(`member`, `manager`). Both are closed sets of code with check constraints, never a pg enum; `manager` is allowed only while the state
is `approved` (a check constraint and the state machine). `organisation_id` is a foreign key to `org_organisation` (`on delete
restrict`: the service removes the rows first, in the delete's transaction); `user_id` is a plain column, so a purge cannot be blocked.
A later request after a rejection or a leave **reopens the same row** (the role goes back to `member`); the history is the audit trail
of the events, there is no history table. Only organisations whose type has `membership: true` accept requests
(`422 membership-not-supported`).

The state machine is one pure function (`service/membership-state.ts`), table-driven tested for every state, role, action and actor:

| Action     | From                       | To                        | Who                                                                              |
| ---------- | -------------------------- | ------------------------- | -------------------------------------------------------------------------------- |
| `request`  | none, `rejected`, `left`   | `requested` (role member) | the person                                                                       |
| `request`  | `requested`, `approved`    | unchanged (idempotent)    | the person                                                                       |
| `approve`  | `requested`                | `approved` (role member)  | an Admin, or a manager of that organisation; never on their own request          |
| `reject`   | `requested`                | `rejected`                | the same                                                                         |
| `withdraw` | `requested`                | `left`                    | the person                                                                       |
| `leave`    | `approved`                 | `left` (role member)      | the person, a manager too                                                        |
| `remove`   | `approved`                 | `left` (role member)      | an Admin (any member or manager); a manager (a plain member only); never oneself |
| `promote`  | `approved`, role `member`  | role `manager`            | an Admin, or a manager of that organisation; never on their own row              |
| `demote`   | `approved`, role `manager` | role `member`             | the same                                                                         |

Promoting a manager or demoting a member is idempotent. Any other pair is `409 membership-state` naming the state, never a 500. A
`requested` row is decided or withdrawn, never removed.

Delegation (who may do what, the rules that cannot be delegated, the last manager, serialisation, the one-request window) is
[ADR-0034](0034-scoped-permissions-at-the-route-and-delegation.md). Limits are settings, not constants:
`membership.maxPendingPerUser` (default 10, `409 too-many-pending`), `membership.maxManagersPerOrganisation` (default 20,
`409 too-many-managers`) and `membership.membersVisibleToMembers` (default on).

**Mail and inbox.** The two membership templates moved here from `core.notifications` (same keys `registry.membership-requested` and
`registry.membership-decided`; the wording says "organisation"). A request goes to the approved managers of that organisation and to
the administrators, de-duplicated, the requester left out; the decision goes to the requester. Both are optional (category
`membership`). A role change and "an organisation has no manager" are inbox items only. A removed person is not mailed (backlog). A
mail names the organisation and the requester's username and never an address beyond the recipient's own.

**Events** carry ids, states and roles: never a username or an address. `registry.membership.decided@1`, `…roleChanged@1` and
`…left@1` are `critical` for `by: admin | manager` in the audit trail.

**Purge.** The module subscribes to `identity.user.purged@1` and deletes the person's memberships (managers' too) in one transaction;
the handler is idempotent. A deactivated account holds no working session or token, so its approved memberships and roles grant
nothing; they still count in `memberCount` and in the manager count until the purge.

## Consequences

- A new organisation type needs no migration.
- M7 and M8 depend on `public.ts` only, with trusted reads that check no permission.
- Sections marked "to be finished" are updated by the sprint that builds them; a decision that changes is a new ADR.
