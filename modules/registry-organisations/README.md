# registry.organisations

The organisation record: providers, consortia and whatever other types a module adds, with a plain-text description, website, `sameAs`
links, ROR id and a contact point. It is the first module that is not a `core.*` module, so it also sets the conventions that the
later registry modules copy: a package that depends on the core modules, registries of its own that other modules contribute to,
events that `core.audit` decides on, and a profile that is not `core-only`
([ADR-0032](../../docs/adr/0032-registry-profile.md), [ADR-0033](../../docs/adr/0033-organisation-model.md),
[m6-sprint-plan.md](../../docs/m6-sprint-plan.md)).

Status: M6 sprint 4, plus the public profile of M7 sprint 3 (the organisation record, its Schema.org profile and logo, membership with organisation managers, editing by an
Admin and by the managers of an organisation, the administrator's editor and the organisation page). The member and manager screens
(sprint 5) follow.

## Manifest

| Part         | Value                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id           | `registry.organisations`                                                                                                                                                                                                                                                                                                                                                                                                   |
| table prefix | `org_` (set in the manifest; ADR-0004): `org_organisation`, `org_membership`                                                                                                                                                                                                                                                                                                                                               |
| dependencies | `core.authz`, `core.settings`, `core.identity`, `core.notifications`, `core.blob`; `core.ui-shell` as an optional peer (the module starts without the shell)                                                                                                                                                                                                                                                               |
| routes       | internal API, see "Routes"                                                                                                                                                                                                                                                                                                                                                                                                 |
| ui           | `ui` entry with the organisation page (`/organisations/:id`), the administrator's editor (`/admin/organisations`, `/new`, `/:id`), the member and manager screen (`/account/organisations`), the administrator's membership requests (`/admin/memberships`), the public page of an organisation (`/public/organisations/:id`, `public: true` with a reason, named in `PUBLIC_PAGES`) and the dashboard card; see "Screens" |
| events       | emits the three organisation events and the four membership events (see "Events"); subscribes to `identity.user.purged@1`                                                                                                                                                                                                                                                                                                  |
| registries   | declares `org.type`, `org.usage` and `org.publicReference`; contributes the seed types to `org.type`, the dashboard card to `ui.widget`, the default roles to `authz.defaultRole`, the policy `organisation.member` to `authz.resourcePolicy` and four templates to `notify.template`                                                                                                                                      |
| settings     | `exposeContactPoint` and the three `membership.*` settings (see "Settings"), shown by the generic settings form                                                                                                                                                                                                                                                                                                            |

### Permissions

| Permission                                         | Allows                                                                                                     | Held by default by                                                        |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `registry.organisations.organisation.read`         | Read organisations and the registered types; the plain permission of every delegated route                 | Admin, User, Reviewer                                                     |
| `registry.organisations.organisation.manage`       | Create and delete organisations, and change every field of one, `type`, `abbreviation` and `name` included | Admin                                                                     |
| `registry.organisations.organisation.edit`         | scoped (`organisation`): change the description, website, `sameAs` links, ROR id, contact point and logo   | Admin; managers                                                           |
| `registry.organisations.v1.read`                   | Read the providers through the public API (`GET /api/v1/providers`); a token must name it as a scope       | Admin, User                                                               |
| `registry.organisations.membership.request`        | Ask to join an organisation, withdraw, leave, and list your own memberships                                | Admin, User                                                               |
| `registry.organisations.organisation.read-contact` | scoped (`organisation`): always see the contact point of an organisation                                   | Admin; managers                                                           |
| `registry.organisations.membership.view-members`   | scoped: see the members of an organisation (usernames and join dates)                                      | Admin; managers; members while `membership.membersVisibleToMembers` is on |
| `registry.organisations.membership.decide`         | scoped: approve or reject requests of an organisation, and list its requests and members                   | Admin; managers                                                           |
| `registry.organisations.membership.manage-roles`   | scoped: promote a member to manager, demote a manager                                                      | Admin; managers                                                           |
| `registry.organisations.membership.remove`         | scoped: end the membership of a member (a manager removes plain members only)                              | Admin; managers                                                           |

Admin holds every declared permission by resolution (ADR-0014); `user` gets `read`, `membership.request` and `v1.read`, `reviewer` gets `read`,
through `authz.defaultRole`. The service checks the permission again on every method (`ctx.authz.require`). `PATCH
/organisations/{id}` and the two logo routes name the plain `…organisation.read` and the service decides (ADR-0034), so that the
managers of an organisation can edit its descriptive fields (ADR-0033, Decision 14); `POST` and `DELETE /organisations` keep `manage`.

**Scoped permissions and the routes (ADR-0034).** The six scoped permissions declare `scope: 'organisation'`. Admin holds them
everywhere (by resolution); the managers, and for `view-members` the members, of **one** organisation hold them through the policy
`organisation.member` (below). **No route names a scoped permission**: the pipeline checks a route's permission without a resource,
which would turn a manager away. A delegated route names the plain `…organisation.read`, which every signed-in person holds, and the
**service is the authorization**: it calls `ctx.authz.require(actor, <scoped permission>, { type: 'organisation', id, … })`. A
delegated route without that service check is a defect; `defect-01.privilege-escalation.test.ts` has a row for each that expects 403
for a plain User.

## The record

`org_organisation`: `id` (UUIDv7), `type` (text, checked against the registry in the service, no enum), `abbreviation`, `name`,
`description` (plain text), `website`, `ror_id`, `same_as` (`text[]`), `contact_email` and `contact_type` (together or not at all),
`logo_blob_id` and `logo_hash` (the logo), `created_at`, `updated_at`, `created_by`, `updated_by`. No foreign key: user ids and the
blob id are kept as written, so a purge or the blob cleanup cannot be blocked.

| Rule              | Value                                                                                                                                              |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| unique per type   | abbreviation and name, case-insensitively (a clear 409 that names the field)                                                                       |
| unique            | ROR id, where it is set                                                                                                                            |
| abbreviation      | 1 to 64 characters, no white space or `/`. It is the **lookup key** of M7 and M8 (`findByAbbreviation`), not the name                              |
| name              | 1 to 200 characters, white space collapsed                                                                                                         |
| description       | plain text, at most 4000 characters, line breaks kept; HTML is stored as text and escaped on output                                                |
| website, `sameAs` | `http(s)` URLs of at most 500 characters, no credentials, no white space; normalised, duplicates removed; at most 20 `sameAs` links; never fetched |
| ROR id            | stored as the bare id (`02skbsp27`); input may be `https://ror.org/<id>` or `ror.org/<id>`; pattern and check digits are verified                  |
| contact point     | one syntactically valid address and a short contact type; no DNS check. It is the organisation's role address, never a user's                      |

Every rule is in `service/fields.ts` (pure, table-driven tests) and in a check constraint of the table, so a second entry point cannot
bypass it. A list row never carries the contact point or the `sameAs` links. The `createdBy`/`updatedBy` columns are shown to
administrators only; the contact point follows the rule below.

### The contact point

The address is the organisation's **role address** (`info@…`), not a user's: it belongs to no account, is never a recipient of a mail
and is never joined to a user. It is shown in `GET /organisations/{id}` and in the Schema.org profile to a reader who holds
`…organisation.read-contact` on that organisation (administrators and the managers of that organisation, through the policy), and to every other signed-in person
while the setting `organisation.exposeContactPoint` is **on** (the default). With the setting off only the first group sees it. The
anonymous reader sees nothing (there is no anonymous route). It is **never** in a list row, an event, an audit entry, a log line or a
mail; the trusted reads of the public service never return it. A test proves that no user's address appears in an organisation
response.

### The logo

`PUT /organisations/{id}/logo` takes the raw image as the body (`Content-Type` ignored, like `PUT /account/avatar`; at most the
upload ceiling of `core.blob`, else 413; `strict` rate limit; audited). The service checks the permission **first** (a denied caller
leaves no file), then calls `blob.put` (a raster is decoded and re-encoded without metadata and scaled; an SVG is sanitised;
anything else, an empty body and a data URL are 422), then in **one transaction** sets `logo_blob_id` and `logo_hash`, calls
`blob.setReference('registry.organisations:logo:<organisation id>', blobId)` and emits `registry.organisation.updated@1` with the
field name `logo`. If that transaction fails the new file is unreferenced and the hourly cleanup removes it after the grace period
(ADR-0018); the row and the reference are as before. The same image again changes nothing and emits nothing.

- **Replacement** releases the old file through `setReference`; it is removed after the grace period, not at once.
- `DELETE /organisations/{id}/logo` clears the columns and the reference in one transaction (404 when there is no logo).
- **Deleting the organisation** releases the reference in the delete's transaction (a rollback keeps it).
- `GET /organisations/{id}` shows `logoUrl` (`<base path>/api/internal/files/{hash}`), absent without a logo. The module never
  serves bytes; the file route of `core.blob` is public and the hash is of the stored bytes, so the logo is public by its hash.

## The Schema.org profile

`service/schema-org.ts` has two pure functions. `toSchemaOrg(source, { origin, basePath, includeContact })` builds a Schema.org
`Organization`; the route and (sprints 4 and M8) the page and the public API use only that function. A property without a value is
omitted, never `null` or empty. `serializeJsonLd(value)` is the only way the profile becomes a string for HTML: `JSON.stringify`,
then `<`, `>`, `&`, U+2028 and U+2029 are written as `\uXXXX`, so the result has no `<` and parses back to the same value.

| Stored field                    | Property                                       | Notes                                                                                            |
| ------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `type` (the `org.type` entry)   | `@type`                                        | the entry's `schemaType`; `Organization` for a type that is no longer registered                 |
| `id`                            | `@id`, `url` fallback                          | `<origin><base path>/organisations/<id>`; the instance origin and `BASE_PATH`, never a constant  |
| `name`                          | `name`                                         |                                                                                                  |
| `abbreviation`                  | `alternateName`                                |                                                                                                  |
| `description`                   | `description`                                  | plain text                                                                                       |
| `website`                       | `url`                                          | the organisation's own site                                                                      |
| `ror_id`                        | `identifier`, and a `sameAs` entry             | `PropertyValue` (`propertyID: "ROR"`, `value: "https://ror.org/<id>"`); the URL once in `sameAs` |
| `same_as`                       | `sameAs`                                       | `http(s)` URLs                                                                                   |
| `logo_hash`                     | `logo`                                         | `ImageObject` with the absolute `/api/internal/files/{hash}` URL                                 |
| `contact_email`, `contact_type` | `contactPoint`                                 | `ContactPoint` (`email`, `contactType`); only for a reader who may see it                        |
| (not stored)                    | `parentOrganization`, `address`, `member`, ... | not built                                                                                        |

### The public profile (M7 sprint 3, ADR-0036 part 2)

An organisation has a public profile exactly while **a public service names it as its provider or as a consortium** (Decision 8). This
module does not know the services: the rule goes through the registry `org.publicReference`, which `registry.services` contributes to (see
"Registries"). `GET /public/organisations/{id}` and `GET /public/organisations/{id}/schema-org` (`public: true`, each with a reason, the
`default` rate limit) answer only then; for every other organisation, an unknown id, an id that is no UUID, and an instance where
`service.allowPublic` is off, the answer is the **404 of an unknown id** with the same body, never a 403. A 200 carries `Cache-Control: public,
max-age=60`: that is the only delay before an unpublish is seen by a shared cache; the server keeps no copy.

**The public page** (M7 sprint 6) is `/public/organisations/:id`: the public record and its public services as links to `/public/services/:slug`. It reads only the two
public routes and draws nothing from a role or a session (no members, no contact point, no membership control); `apps/web/src/service-page.test.ts` renders it
in a harness where reading the session throws, and the output is the same for every visitor. An organisation no public service names is the shell's 404.

The public record is a pinned list of fields: `id`, `name`, `abbreviation`, `logoUrl`, `description`, `website`, `rorId`, `sameAs` and
`services` as `{ id, slug, name }` (by name). It has no `type`, no contact point, no member count, no audit column. The public profile is the
profile above built with `includeContact: false`. `apps/server/src/public-records.test.ts` pins the names; `service/public.test.ts` proves the rule
with a fixture contributor.

## Membership

A person asks to join an organisation of a type with `membership: true` (`provider` and `consortium`); an Admin or a manager of that
organisation decides; a member may be given the role of manager; members are removed or leave. One row per person and organisation
in `org_membership`: a later request after a rejection or a leave **reopens the same row** (the role goes back to `member`), and the
history is the audit trail of the events. `state` (`requested`, `approved`, `rejected`, `left`) and `role` (`member`, `manager`) are
closed sets of code with check constraints, never a pg enum; `manager` is allowed only while `approved`. `user_id` has no foreign key
(a purge cannot be blocked); `organisation_id` is a foreign key to `org_organisation` that restricts, so the service removes the rows
of an organisation first, in the delete's transaction.

### States, roles and transitions

`service/membership-state.ts` is one pure function, `transition(current, action, by)`, with a table-driven test over every state,
role, action and actor. Anything not in the table is `409 membership-state` naming the state, never a 500.

| Action     | From                       | To                          | Who (`by`)                                                                           |
| ---------- | -------------------------- | --------------------------- | ------------------------------------------------------------------------------------ |
| `request`  | none, `rejected`, `left`   | `requested` (role `member`) | the person                                                                           |
| `request`  | `requested`, `approved`    | unchanged (idempotent)      | the person: `200` and the current row, no second event or mail                       |
| `approve`  | `requested`                | `approved`                  | an Admin, or a manager of that organisation; never on their own request              |
| `reject`   | `requested`                | `rejected`                  | the same                                                                             |
| `withdraw` | `requested`                | `left`                      | the person (`DELETE /organisations/{id}/membership`)                                 |
| `leave`    | `approved`                 | `left`, role `member`       | the person, a manager too                                                            |
| `remove`   | `approved`                 | `left`, role `member`       | an Admin (any member or manager); a manager (a **plain member** only); never oneself |
| `promote`  | `approved`, role `member`  | role `manager`              | an Admin, or a manager of that organisation; never on their own row                  |
| `demote`   | `approved`, role `manager` | role `member`               | the same                                                                             |

Promoting a manager or demoting a member is idempotent (`200`, no event). A `requested` row is decided or withdrawn, never removed.

### Who may do what (ADR-0034)

| Action                   | Admin              | Manager of that organisation | Approved member                                       | Others              |
| ------------------------ | ------------------ | ---------------------------- | ----------------------------------------------------- | ------------------- |
| view the members         | yes                | yes                          | yes, while `membership.membersVisibleToMembers` is on | no                  |
| list and decide requests | yes                | yes, never their own request | no                                                    | no                  |
| promote, demote          | yes                | yes, never their own role    | no                                                    | no                  |
| remove                   | yes, a manager too | a plain member only          | no                                                    | no                  |
| read the contact point   | yes                | yes                          | the setting decides                                   | the setting decides |
| ask, withdraw, leave     | own row            | own row                      | own row                                               | own row             |

- **Nobody approves their own request**, an Admin or a manager included: every decision passes `approval: true` and `requestedBy` to
  `ctx.authz.require`, and `core.authz` denies it before roles and policies. A manager who asked to join another organisation cannot
  decide that request either.
- **Nobody changes their own role** (an Admin who is a member cannot make themselves manager; another Admin or manager can),
  **nobody removes themselves** (that is `leave`) and **a manager never removes another manager** (only an Admin does; a manager can
  demote one).
- **A manager of A has no right on B.** The scoped check takes the organisation of the membership row.
- **The caller who may act nowhere.** A decision, role change or removal first checks that the caller is an Admin or manages at least
  one organisation; anybody else is `403` before the id is looked up, so a plain User cannot tell an unknown id from a known one. A
  manager who names a membership of another organisation gets `403`; a manager who names an unknown id gets `404`.
- **Per-call reads.** The policy reads the caller's membership from the database on every call (no cache), so a demotion or a removal
  takes effect at the next call. A decision that passed the check a moment before a demotion committed is allowed once (ADR-0034).
- **Tokens.** The scope gate comes first: a token passes only for a scope it names **and** what its owner holds. A manager's token needs
  `…organisation.read` for the route and the scoped permission for the action; without the scope the answer is `403`, also for a list.

### The last manager

The last manager may leave, be demoted (by an Admin or by another manager; never by themselves), be removed by an Admin or be purged.
Nothing blocks it. The organisation then **has no manager and falls back to administrators**: requests are announced to and decided by
Admins only until somebody is promoted. The event carries `organisationHasManager: false` and an inbox item (category `membership`,
no mail) goes to every administrator. The limit is `membership.maxManagersPerOrganisation` (default 20, `409 too-many-managers`); it
bounds the mail a request sends.

### Serialising changes

Every state or role change locks the membership row (`select … for update`) in its transaction and reads the state **and the role**
again under the lock, so a second decider gets `409 membership-state`, a second promotion is idempotent, and a member promoted a moment
before cannot be removed by a manager. What spans rows (the number of managers: the limit, and `organisationHasManager`) takes a
transaction-scoped advisory lock on the organisation **after** the row locks; one person's requests take an advisory lock on the
person, so the cap on open requests cannot be passed by two requests at once. A request takes `for share` on the organisation, so it
never meets a half-deleted one. The tests race two real connections and hold a lock from a second one (`memberships.concurrency.test.ts`).

### Mail and inbox

The two membership templates came from `core.notifications` with the same keys; this module contributes them to `notify.template` and
the wording says "organisation" (consortium memberships use the same mails). All four are in category `membership`, which a person may
switch off.

| Template                                | To                                                                                                  | Channels       |
| --------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------- |
| `registry.membership-requested`         | the approved managers of the organisation and the administrators, once each, the requester left out | mail and inbox |
| `registry.membership-decided`           | the requester, in their language                                                                    | mail and inbox |
| `registry.membership-role-changed`      | the person whose role changed                                                                       | inbox only     |
| `registry.organisation-without-manager` | every administrator                                                                                 | inbox only     |

Recipients are looked up through the public service of `core.identity` (this module reads no identity table); a deactivated or deleted
account gets nothing, an account without an address still gets the inbox item. A mail names the organisation and, for a request, the
requester's username; never an address beyond the recipient's own. Links are `<ORIGIN><BASE_PATH><page>`: a manager is sent to
`/account/organisations`, an administrator to `/admin/memberships`, the requester to `/organisations/<id>` (the screens are sprint 5).
A person who is both manager and administrator gets one mail, with the administrators' link. A removed person is not mailed (backlog).

### The policy `organisation.member`

Contributed to `authz.resourcePolicy` (`service/policy.ts`). It answers per permission from the caller's **approved** membership of
`resource.id`, read from the database on every call: a manager holds the six scoped permissions (`edit` included); an approved member holds
`view-members` while the setting is on; a requested, rejected or left row, a membership of another organisation, a resource without a
valid id and a permission it does not know grant nothing. It only adds access and cannot override the `approval` rule. `…organisation.edit` is narrowed by the
field rules of the service, never by the policy: a manager never writes `type`, `abbreviation` or `name`.

### Purge and deactivation

The module subscribes to `identity.user.purged@1` and deletes the person's memberships, managers' too, in one transaction; running it
twice finds nothing. An ended approved membership emits `registry.membership.left@1` with `by: system`, and a purged last manager
announces "no manager" as above. A **deactivated** account has no working session or token, so its approved memberships and roles grant
nothing; they still count in `memberCount` and in the manager count until the purge (backlog: count active accounts only).

## Settings

| Setting                                 | Default | Meaning                                                                                           |
| --------------------------------------- | ------- | ------------------------------------------------------------------------------------------------- |
| `exposeContactPoint`                    | on      | every signed-in person sees an organisation's contact point (see "The contact point")             |
| `membership.maxPendingPerUser`          | 10      | open requests one person may have (1 to 100); the next is `409 too-many-pending`                  |
| `membership.membersVisibleToMembers`    | on      | an approved member sees usernames and join dates of the other members; managers and Admins always |
| `membership.maxManagersPerOrganisation` | 20      | managers one organisation may have (1 to 100); a promotion over it is `409 too-many-managers`     |

## The public service

`public.ts` exports the registries' names and entry shapes and `OrganisationsPublic`, the reads for M7 and M8. They are **trusted**:
they check no permission and name no caller (ADR-0015, hence the `AsSystem` suffix), so a route that uses one checks its own
permission first. They return the descriptive fields only (`OrganisationRecord`, with `memberCount`): never the contact point, the audit columns or the
logo hash; the membership reads answer from ids and name nobody. M7's `service.member` asks `isApprovedMemberAsSystem` and
`listApprovedOrganisationIdsAsSystem`.

| Method                                             | Returns                                                                                                         |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `findByIdsAsSystem(ids)`                           | the records of the known ids (unknown and malformed ids are ignored)                                            |
| `findByAbbreviationAsSystem(type, abbreviation)`   | one record or `undefined`; case-insensitive, within the type                                                    |
| `existsAsSystem(id)`                               | `boolean`                                                                                                       |
| `listTypesAsSystem()`                              | the registered types, labels in English                                                                         |
| `toSchemaOrgAsSystem(id, { includeContact? })`     | the profile or `undefined`; `includeContact` defaults to `false`                                                |
| `isApprovedMemberAsSystem(userId, organisationId)` | `boolean`: an approved membership (a manager is a member)                                                       |
| `listApprovedOrganisationIdsAsSystem(userId)`      | the ids of the organisations the person is an approved member of                                                |
| `countApprovedMembersAsSystem(organisationIds)`    | `{ [organisationId]: n }`, `0` for an organisation without members                                              |
| `isManagerAsSystem(userId, organisationId)`        | `boolean`: an approved manager                                                                                  |
| `listApprovedManagerIdsAsSystem(organisationId)`   | the user ids of the approved managers, by id (M7: the publication notice)                                       |
| `listApprovedMemberIdsAsSystem(organisationId)`    | the user ids of the approved members, managers included, by id (M10: the reporting reminder of `kpi.ingestion`) |

**Who writes which field (Decision 14).** `service/field-rules.ts` is the one table, for both editor groups: `type`,
`abbreviation` and `name` need `admin` access (`…organisation.manage`, an Admin); `description`, `website`, `sameAs`, `rorId`, the
contact point and the logo need `edit` (`…organisation.edit` on that organisation: an Admin, or an approved manager of it). One
`update` method and one logo path serve both, with one normalisation and one validation.

- The order is: the id (422), the organisation (404, readable by every signed-in person, so it reveals nothing), what the caller holds
  on it, then the input (422). A caller who holds nothing gets the plain 403 (401 without a session).
- A manager who names `type`, `abbreviation` or `name` gets 403 "These fields can only be changed by an administrator: name." The
  message lists field names, never values, and the request is refused whole: nothing is written, not even the allowed fields.
- `create` and `delete` need `manage`: a manager gets 403 on both, for their own organisation too.
- The logo methods decide before `blob.put`, so a denied caller leaves no file behind.
- `editableFields` on `GET /organisations/{id}` (and on every answer that shows the organisation) is computed by the same table: all
  fields for an Admin, the descriptive ones for a manager of that organisation, none for anybody else. Screens draw forms from it; the
  server still refuses what is not allowed.
- An Admin who is also a manager of the organisation counts as `admin` (`by: 'admin'` in the event).
- Two editors changing different fields both stick (an update sets only the given columns, `updated_at` and `updated_by`); on the same
  field the last write wins, and the events show both. A duplicate ROR id is a 409 that names the field and nothing about the other
  organisation.
- The contact point is the organisation's role address, not a user's: it is never the recipient of a mail, so a manager cannot
  redirect mail by editing it.
- No review step for manager edits in M6 (Decision 19): the edit applies at once and `core.audit` logs it as critical.

## Registries

### `org.type` (declared here, a code registry, not a vocabulary)

An entry is `{ id, labels: { en, de? }, membership, schemaType?, order }`. `id` is the stored value; `membership` says whether people
may become members of an organisation of this type; `schemaType` is the schema.org class of the profile (default `Organization`; one
of `Organization`, `ResearchOrganization`, `FundingAgency`, `NGO`, `GovernmentOrganization`, `EducationalOrganization`). This module
contributes `provider` and `consortium` (both `membership: true`). The loader refuses an invalid entry and a contributor that does not
depend on this module; the service refuses a type id that two modules contribute. `GET /organisation-types` lists the entries in
`order`, then id.

An organisation whose type is no longer registered (the module that contributed it left the profile) is still listed and readable
with `typeKnown: false`. It cannot be changed until the type is back; it can still be deleted if nothing counts a reference.

**How to add an organisation type.** In the module that needs it (it must list `@scorpion/registry-organisations` in its
`package.json` dependencies), contribute an entry; no migration and no change to this module:

```ts
contributes: {
  'org.type': [
    { id: 'funder', labels: { en: 'Funder', de: 'Förderer' }, membership: false, schemaType: 'FundingAgency', order: 30 },
  ],
},
```

### `org.publicReference` (declared here)

An entry is `{ id, list(organisationId) }`: it lists the **public** records that name the organisation as `{ id, slug, name }` (M7: the
services it is provider or consortium of), and an empty list when it has none or when public reads are switched off. An organisation is public
exactly when the merged lists are not empty; the public record shows them as `services`. Entries are asked at every request (nothing is cached) and
a wrong entry fails at start with the contributing module's name. It is not `org.usage`: usage says "something refers to it" and blocks a delete,
this says "something public refers to it" and opens a read.

### `org.usage` (declared here)

An entry is `{ id, count(tx, organisationId) }`, where `id` is the contributing module's id. Deleting an organisation, and changing its
type, ask every entry; a count above zero is `409 organisation-in-use` and the problem names the module ids, never the rows. M7
contributes the entry for `service_organisation`. With no contributor nothing blocks.

## Events

All schemas are `z.strictObject`; payloads hold ids, states and roles, never a username, an address, a URL or a value.

| Event                               | Payload                                                                                                                              | Audit                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| `registry.organisation.created@1`   | `organisationId`, `type`, `actorId`                                                                                                  | logged, not critical                                   |
| `registry.organisation.updated@1`   | `organisationId`, `fields`, `by` (`admin` \| `manager`), `actorId`                                                                   | logged; **critical** when `by` is `manager`            |
| `registry.organisation.deleted@1`   | `organisationId`, `type`, `actorId`                                                                                                  | logged, not critical                                   |
| `registry.membership.requested@1`   | `membershipId`, `organisationId`, `userId`                                                                                           | logged, not critical                                   |
| `registry.membership.decided@1`     | `membershipId`, `organisationId`, `userId`, `state` (`approved` \| `rejected`), `by`, `actorId`                                      | logged, **critical**                                   |
| `registry.membership.left@1`        | `membershipId`, `organisationId`, `userId`, `by` (`member` \| `admin` \| `manager` \| `system`), `actorId`, `organisationHasManager` | logged; **critical** when `by` is `admin` or `manager` |
| `registry.membership.roleChanged@1` | `membershipId`, `organisationId`, `userId`, `from`, `to`, `by`, `actorId`, `organisationHasManager`                                  | logged, **critical**                                   |

`fields` holds the names of the changed fields (`description`, `sameAs`, `rorId`, `contact`, `logo`, ...), never their values (a test
checks the payload: no address, no URL, no hash); `by` is `admin` when the actor holds `…organisation.manage` (an Admin who is also a manager counts as `admin`) and `manager` otherwise. A manager's edit is critical (Decision 19: administrators see every manager edit; cheap to relax in `core.audit`'s `decisions.ts`). `by: system` is a purge (no actor).
An approval or a role change is a permission-relevant act, like an approved account and a role assignment, hence critical (logged
whatever `channels.admin` says). The name is `roleChanged`, not `role-changed`: the kernel's event names allow letters and digits only.
`core.audit` has a decision for each and lists this module as an optional peer; the subject of a membership event is the membership.
The routes with `audit: true` also write an entry in the request log, also when the caller was turned away.

## Routes

Internal API (`/api/internal`). Lists use the legacy envelope (`metadata`, `result`, 0-based pages) with a stable sort. Invalid input
is 422 problem+json; nothing the caller sends becomes a 500. The two public routes of M7 sprint 3 are at the end of the table. A row marked **delegated** names the
plain `…organisation.read` and is authorised by its service (ADR-0034); a manager's rows carry `allowedActions` (what the caller may
do to the row now, for drawing buttons) and never an address.

| Route                                       | Permission                                   | Notes                                                                                                                                                                |
| ------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /organisations`                        | `registry.organisations.organisation.read`   | `q` (abbreviation or name, `%` `_` `\` are text), `type`, `page`, `pageSize` (at most 100)                                                                           |
| `GET /organisations/{id}`                   | `registry.organisations.organisation.read`   | with `sameAs`, ROR id, `logoUrl`, `editableFields`; the contact point as in "The contact point"                                                                      |
| `GET /organisations/{id}/schema-org`        | `registry.organisations.organisation.read`   | `application/ld+json`, `Cache-Control: private, no-cache`; 404, 422; no anonymous access                                                                             |
| `PUT /organisations/{id}/logo`              | `registry.organisations.organisation.read`   | **delegated** (`manage` or `…organisation.edit`): raw image body; 403, 404, 413, 422; strict rate limit; audited                                                     |
| `DELETE /organisations/{id}/logo`           | `registry.organisations.organisation.read`   | **delegated** (as above): 403; 404 when there is no logo; audited                                                                                                    |
| `POST /organisations`                       | `registry.organisations.organisation.manage` | 201; 409 duplicate; 422 unknown type or bad input; audited                                                                                                           |
| `PATCH /organisations/{id}`                 | `registry.organisations.organisation.read`   | **delegated**: partial; `null` clears an optional field; 403 (a manager naming `type`, `abbreviation` or `name`: refused whole), 404, 409, 422; audited              |
| `DELETE /organisations/{id}`                | `registry.organisations.organisation.manage` | 204; by id only; 409 `organisation-in-use` while `org.usage` counts; audited                                                                                         |
| `GET /organisation-types`                   | `registry.organisations.organisation.read`   | the registered types, labels for `locale`                                                                                                                            |
| `GET /public/organisations/{id}`            | **public**                                   | the public record; 404 with the body of an unknown id unless a public service names the organisation; `Cache-Control: public, max-age=60`; `default` rate limit      |
| `GET /public/organisations/{id}/schema-org` | **public**                                   | `application/ld+json` without a contact point; the same 404 rule and cache header                                                                                    |
| `POST /organisations/{id}/membership`       | `registry.organisations.membership.request`  | `201` a new or reopened request, `200` when already asked or a member; 422 `membership-not-supported`; 409 `too-many-pending`                                        |
| `DELETE /organisations/{id}/membership`     | `registry.organisations.membership.request`  | withdraws or leaves; 404 when there is neither                                                                                                                       |
| `GET /account/memberships`                  | `registry.organisations.membership.request`  | the caller's own rows in every state, with `role`                                                                                                                    |
| `GET /organisations/{id}/members`           | `registry.organisations.organisation.read`   | **delegated**: the service requires `…membership.view-members`; usernames and join dates                                                                             |
| `GET /memberships`                          | `registry.organisations.organisation.read`   | **delegated**: requests and members the caller may decide on, oldest first; `state`, `organisationId`, `type`; 403 for anybody who is neither an Admin nor a manager |
| `GET /memberships/summary`                  | `registry.organisations.organisation.read`   | `{ pending, manages }` for the dashboard card; zeros for a plain user, never 403                                                                                     |
| `POST /memberships/{id}/decision`           | `registry.organisations.organisation.read`   | **delegated** (`…membership.decide`): `{ decision }`; audited; 403 own request or no right; 409 `membership-state`                                                   |
| `POST /memberships/{id}/role`               | `registry.organisations.organisation.read`   | **delegated** (`…membership.manage-roles`): `{ role }`; audited; 403 own role; 409 `membership-state`, `too-many-managers`                                           |
| `POST /memberships/{id}/remove`             | `registry.organisations.organisation.read`   | **delegated** (`…membership.remove`): audited; 403 own row, a manager as the target of a manager, no right; 409 `membership-state`                                   |

### The v1 routes `GET /api/v1/providers` and `GET /api/v1/providers/{id}` (M8 sprint 2, ADR-0037)

Permission `registry.organisations.v1.read` (granted to `user` by default). "Providers" are the organisations of the `provider` type. Query: `page`,
`pageSize` (default and maximum 100; more is 422), `is_member` (`true` or `false`, nothing else: 422). An unknown query parameter is a 422. Sorted by abbreviation (without case), then id. `GET /api/v1/providers/{id}` returns the same row for one provider: 404 for an unknown id and for an organisation that is not a provider, 422 for an id that is not a UUID.

| Field          | Type           | Source                                                                 |
| -------------- | -------------- | ---------------------------------------------------------------------- |
| `id`           | string (UUID)  | `org_organisation.id`                                                  |
| `abbreviation` | string         | `abbreviation`                                                         |
| `name`         | string         | `name`                                                                 |
| `description`  | string or null | `description` (plain text)                                             |
| `website`      | string or null | `website`                                                              |
| `rorId`        | string or null | `ror_id`, the bare id                                                  |
| `sameAs`       | string[]       | `same_as`                                                              |
| `isMember`     | boolean        | the token owner has an **approved** membership (a manager is a member) |

Left out of the internal read, and why:

| Internal field                                     | Why it is not in v1                                                                                                         |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `contactEmail`, `contactType`                      | never in v1 (decision of the maintainer)                                                                                    |
| `type`, `typeKnown`                                | every row is a provider; the type registry is internal                                                                      |
| `memberCount`                                      | not a legacy field; it is derived from the membership table, which v1 treats as private; additive later                     |
| `myMembership` (state and role)                    | the person's own requested, rejected and left rows are their business; v1 gives the one boolean a client needs (`isMember`) |
| `logoUrl`                                          | a path below `/api/internal/files`, which is not part of v1                                                                 |
| `editableFields`                                   | a hint for the screens, about the caller                                                                                    |
| `createdAt`, `updatedAt`, `createdBy`, `updatedBy` | audit columns; not legacy fields; additive later                                                                            |

## Screens

The pages are contributed to `ui.routes` and `ui.nav` of `core.ui-shell` (an optional peer: without the shell the module starts and
serves its API). The server half is `ui/routes.ts`, the browser half `ui/index.ts`; `ui/ui.test.ts` checks that they agree. All
fetches go through the typed client, every link through `href()`, and no filesystem route is added (the shell's catch-all renders them).

| Page                       | Permission                                   | Shows                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/organisations/:id`       | `registry.organisations.organisation.read`   | logo, name, abbreviation, the type's label (from the registry entry), description, website, ROR id and `sameAs` links (`rel="noopener noreferrer"`), the contact point when the API returned it, the member count, the viewer's own membership with its action, the member list when the API allows it, a link to the editor for an Admin, and the JSON-LD block in the head                                                                      |
| `/admin/organisations`     | `registry.organisations.organisation.manage` | the list: search, type filter, 0-based pages (the server sorts by abbreviation, then id); a nav entry in the administration section                                                                                                                                                                                                                                                                                                               |
| `/admin/organisations/new` | `registry.organisations.organisation.manage` | the create form with every field                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `/admin/organisations/:id` | `registry.organisations.organisation.manage` | the editor: the form drawn from `editableFields`, the logo block, and the delete behind a confirm that says what goes with it (the memberships and the logo); `409 organisation-in-use` is shown in words naming the module                                                                                                                                                                                                                       |
| `/account/organisations`   | `registry.organisations.organisation.read`   | your memberships with state and role badges (words, never colour alone) and a withdraw or leave action; the search (name or abbreviation, a type filter, **5 per page**, member counts, a "Pending", "Member" or "Manager" badge on rows you have, and a request button where a request can work); and, **only when `GET /memberships/summary` says `manages: true`**, the section "My organisations" (below). A nav entry in the account section |
| `/admin/memberships`       | `registry.organisations.organisation.manage` | the requests of every organisation, oldest first, with filters by state (default: pending), organisation and type, and approve, reject, promote, demote and remove from `allowedActions`; no button on the viewer's own row, with the reason in words; a nav entry in the administration section. The page the administrators' mail and inbox item link to                                                                                        |

**Widgets.** `ui.widget` contributes one card to the `dashboard` slot (`membership-requests`, permission `…organisation.read`; since M11 sprint 2 a tile of the dashboard grid with `label` `dash.membership.title`, icon `list`, size 4×3 (3 to 8 wide, 2 to 6 high) and the default placement `x: 8, y: 0`, last in the default row; it draws no element at zero, which the grid takes as "nothing to show" and removes from view): "N requests
are waiting for a decision" with a link to `/admin/memberships` for a caller whose navigation lists it (an Admin) and to
`/account/organisations` for everybody else. It reads `GET /memberships/summary` and draws **nothing** when `pending` is zero or the call
fails, so a plain User never sees a card or an error. The heading is an `h2`, as the slot's other cards.

**The manager section.** For each organisation the caller manages (the `approved` rows with the role `manager` of their own list, and
only when `manages` is true) the page shows a card with three parts: _Requests_ (approve, reject behind a short confirm; the decided
rows stay in view with their outcome until the page is left), _Members_ (promote, demote and remove, each drawn from the row's
`allowedActions`; the caller's own row and, for a manager, another manager's remove button are not drawn and a sentence says why; "No
manager: administrators decide." when the list names none) and _Edit organisation_ (`ui/ManagerOrganisation.svelte`). The edit form is the
same `OrganisationForm` and `LogoBlock` as the administrator's, fed by `editableFields` of `GET /organisations/{id}`, so it offers the
description, website, `sameAs` links, ROR id, contact point and logo; `type`, `abbreviation` and `name` are shown as plain text with the
line "Only an administrator can change these; ask one." (when the API lets the caller write them, the line and the text are not drawn).
There is no create and no delete. A 403 from a stale page is shown in words and the page reloads. Lists show at most 100 rows and say
when there are more.

**What the page never does.** It never decides a right from a role: buttons come from `allowedActions`, forms from `editableFields`,
the manager section from `summary.manages`. The server checks every action again (ADR-0034). Focus: after an action the focus goes to
the line that says what happened (the pressed button may have left with its row); a dialog returns it to the button that opened it.

**Tests of the screens.** `ui/member-query.test.ts` and `ui/membership-rows.test.ts` are table-driven (the addresses and the pagination of
the two lists, the sentence that explains a missing button, the badge words); `ui/ui.test.ts` checks the pages, the navigation, the card
and the catalogues; `apps/web/src/membership-pages.test.ts` renders the pages on the server through a stand-in for the shell
(`apps/web/src/test/ShellHarness.svelte`) and fixes the own-request and own-role states, the remove buttons, the read-only identity fields and
the hidden manager section. The journeys 2 to 7 and the axe and keyboard runs are in `apps/web/e2e`.

The form is ui-kit's `SchemaForm`, fed by a JSON Schema from `ui/form-schema.ts` whose limits a test keeps equal to `service/fields.ts`.
It draws only the fields the caller may write; two widgets are the module's own: the type select (options and labels from `GET
/organisation-types`, never from the code) and the ROR id (a pasted ror.org link previews as the bare id; the server judges the rest).
`ui/patch.ts` turns the form's values into a PATCH of what changed (an emptied field is `null`, the two halves of the contact point go
together). The logo block (`ui/LogoBlock.svelte`) is shared with the manager's form. Every text is in `en` and `de`.

**The JSON-LD block.** The page's server load calls `GET /organisations/{id}/schema-org` with the visitor's session, so the contact
point is in the block exactly when the route includes it, and the component `JsonLd.svelte` (moved to `packages/ui-kit` in M7 sprint 3, one input: the output of `serializeJsonLd`) writes `serializeJsonLd(profile)` into
`<svelte:head>`. It is the one `{@html}` of the module (ADR-0033, Decision 17): the ESLint exception names exactly that file, its only
input is the escaped JSON, and a `<script type="application/ld+json">` is a data block that needs no CSP allowance.

## Adding the module to a profile

A profile lists the module in `profiles/<name>.ts` (`defineProfile`; `pnpm modules:sync` keeps the id list that the helper checks
against) and the build bakes it in: `pnpm scorpion profile:generate <name>` writes the server and web halves, and the image of the
profile has to be rebuilt (there is no runtime plugin loading). The module needs `core.authz`, `core.settings`, `core.identity`,
`core.notifications` and `core.blob` in the same profile; `core.ui-shell` makes the screens appear and `core.audit` makes the events
visible in the trail, and the module starts, serving its API, without either. The `registry` profile holds exactly these modules
([ADR-0032](../../docs/adr/0032-registry-profile.md)).

## Operating notes

- A deployment that drops a module which contributed an organisation type keeps the organisations of that type, read-only. Keep the
  module, or delete the organisations.
- `memberCount` counts approved members (managers included) and, with the caller's own row (`myMembership`), is computed for a whole page in two grouped queries.
- Usernames in a manager's list come from `core.identity` one lookup per distinct person on the page (at most the page size); a batch lookup would need a change in a scoped path (backlog).
- The image of the `registry` profile (`dev-registry`, `<x.y.z>-registry`) holds the core modules and this module.

## Demo data (`scorpion seed --demo`)

`demoSeed` creates three fictional providers (EBC, SDI, DCF) and one consortium (ERN) with `create`, as the demo administrator, and asks for the membership of `demo-user` in the
first provider and approves it as the administrator (so a documented journey can create a service). Names, addresses and contact points are on `example.org` and
`*.example.org`; there is no ROR id. A second run finds each organisation by its abbreviation and adds nothing ([ADR-0046](../../docs/adr/0046-demo-seed.md)).

## Tests

`service/fields.test.ts`, `service/field-rules.test.ts` and `service/membership-state.test.ts` are table-driven and need no database.
`service/organisations.test.ts` covers every organisation method against real Postgres, each with a denied case and each write with a
rollback case (the outbox is broken so the event cannot be stored). `service/editing.test.ts` is the two editor groups: an Admin on every
field, a manager on each descriptive field and refused whole on the identity fields, another organisation, members and non-members,
demoted managers, tokens, rollbacks, two editors, `editableFields` and the events without values; `ui/*.test.ts` are the table-driven
tests of the screens' helpers and `apps/web/src/json-ld.test.ts` renders hostile data through ui-kit's `JsonLd.svelte`. The journeys are in
`apps/web/e2e/organisations.spec.ts` and `accessibility-organisations.spec.ts`. The membership service has one file per concern, all over real
Postgres and the real authoriser: `memberships.request.test.ts` (requests, the cap, mail and inbox in `en` and `de`, withdrawing,
leaving), `memberships.decisions.test.ts` (decide, roles, removal, the last manager, rollbacks of the mail, the inbox item and the
event), `memberships.lists.test.ts` (who sees which rows, no address, the counts, the trusted reads), `memberships.concurrency.test.ts`
(two connections and real locks), `memberships.purge.test.ts` (the subscriber, delivered by the real dispatcher) and `policy.test.ts`
(every kind of reader against every scoped permission, a token without the scope, the approval rule, per-call reads).
`delegation-prototype.test.ts` and `apps/server/src/defect-01.delegated-routes-prototype.test.ts` are the prototypes that decided
ADR-0034 and stay as regression tests. `templates/registry.test.ts` renders the four templates in both languages (snapshots).
`service/registries.test.ts` loads a fixture module next to this one that contributes a `funder` type and an `org.usage` entry, and
the failures a bad contribution causes. `service/schema-org.test.ts` is table-driven (the mapping, `/` and `/a/b`, hostile text).
`service/profile.test.ts` covers the profile, the contact point matrix and the trusted reads; `service/logo.test.ts` the upload,
replacement, removal and the rollback cases. `module.test.ts` checks the manifest, the prefix, that no route names a scoped permission
and that there is no enum. The route tests are in `apps/server/src/organisation-routes.test.ts`, `organisation-editing-routes.test.ts` and `membership-routes.test.ts`;
the denied cases of every route are in `defect-01.privilege-escalation.test.ts` (the matrix, which proves the service answer for the
delegated rows) and the self cases in `defect-01.membership.test.ts`.
