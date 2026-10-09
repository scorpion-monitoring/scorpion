# registry.organisations

The organisation record: providers, consortia and whatever other types a module adds, with a plain-text description, website, `sameAs`
links, ROR id and a contact point. It is the first module that is not a `core.*` module, so it also sets the conventions that the
later registry modules copy: a package that depends on the core modules, registries of its own that other modules contribute to,
events that `core.audit` decides on, and a profile that is not `core-only`
([ADR-0032](../../docs/adr/0032-registry-profile.md), [ADR-0033](../../docs/adr/0033-organisation-model.md),
[m6-sprint-plan.md](../../docs/m6-sprint-plan.md)).

Status: M6 sprint 1 (the module and the organisation record). Schema.org profile and logo (sprint 2), membership (sprint 3) and the
screens (sprints 4 and 5) follow; the columns `logo_blob_id` and `logo_hash` exist but stay unused until sprint 2.

## Manifest

| Part         | Value                                                                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| id           | `registry.organisations`                                                                                                                                     |
| table prefix | `org_` (set in the manifest; ADR-0004): `org_organisation`                                                                                                   |
| dependencies | `core.authz`, `core.settings`, `core.identity`, `core.notifications`, `core.blob`; `core.ui-shell` as an optional peer (the module starts without the shell) |
| routes       | internal API, see "Routes"                                                                                                                                   |
| ui           | `ui` entry with no pages yet (sprints 4 and 5)                                                                                                               |
| events       | emits `registry.organisation.created@1`, `.updated@1`, `.deleted@1`; subscribes to nothing                                                                   |
| registries   | declares `org.type` and `org.usage`; contributes the seed types to `org.type` and the default roles to `authz.defaultRole`                                   |
| settings     | none in sprint 1 (`organisation.exposeContactPoint` arrives in sprint 2, the membership limits in sprint 3)                                                  |

### Permissions

| Permission                                   | Allows                                      | Held by default by |
| -------------------------------------------- | ------------------------------------------- | ------------------ |
| `registry.organisations.organisation.read`   | Read organisations and the registered types | Admin, User        |
| `registry.organisations.organisation.manage` | Create, change and delete organisations     | Admin              |

Admin holds every declared permission by resolution (ADR-0014); `user` gets `read` through `authz.defaultRole`. The
service checks the permission again on every method (`ctx.authz.require`). In sprint 4 `PATCH /organisations/{id}` and the logo
routes switch their route permission to `…organisation.read` and the service decides, so that the managers of an organisation can edit
the descriptive fields (ADR-0033, Decision 14); `POST` and `DELETE` keep `manage`.

## The record

`org_organisation`: `id` (UUIDv7), `type` (text, checked against the registry in the service, no enum), `abbreviation`, `name`,
`description` (plain text), `website`, `ror_id`, `same_as` (`text[]`), `contact_email` and `contact_type` (together or not at all),
`logo_blob_id` and `logo_hash` (sprint 2), `created_at`, `updated_at`, `created_by`, `updated_by`. No foreign key: user ids and the
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
bypass it. A list row never carries the contact point or the `sameAs` links. The contact point and the `createdBy`/`updatedBy`
columns are shown to administrators only in sprint 1; sprint 2 decides the wider rule.

**Who writes which field.** `service/field-rules.ts` is the one table: `type`, `abbreviation` and `name` need `admin` access; the
descriptive fields need `edit`. In sprints 1 to 3 both need `…organisation.manage` (Admin); sprint 4 lets the managers of the
organisation pass the `edit` case and nothing else, through the same `update` method. A request that touches a field its caller may
not write is refused whole.

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

### `org.usage` (declared here)

An entry is `{ id, count(tx, organisationId) }`, where `id` is the contributing module's id. Deleting an organisation, and changing its
type, ask every entry; a count above zero is `409 organisation-in-use` and the problem names the module ids, never the rows. M7
contributes the entry for `service_organisation`. With no contributor nothing blocks.

## Events

| Event                             | Payload                                     | Audit                |
| --------------------------------- | ------------------------------------------- | -------------------- |
| `registry.organisation.created@1` | `organisationId`, `type`, `actorId`         | logged, not critical |
| `registry.organisation.updated@1` | `organisationId`, `fields`, `by`, `actorId` | logged, not critical |
| `registry.organisation.deleted@1` | `organisationId`, `type`, `actorId`         | logged, not critical |

`fields` holds the names of the changed fields (`description`, `contact`, ...), never their values; `by` is `admin` (and `manager`
from sprint 4). `core.audit` has a decision for each and lists this module as an optional peer. The routes with `audit: true` also
write an entry in the request log.

## Routes

Internal API (`/api/internal`). Lists use the legacy envelope (`metadata`, `result`, 0-based pages) with a stable sort. Invalid input
is 422 problem+json; nothing the caller sends becomes a 500. There is no public route in M6.

| Route                        | Permission                                   | Notes                                                                                      |
| ---------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `GET /organisations`         | `registry.organisations.organisation.read`   | `q` (abbreviation or name, `%` `_` `\` are text), `type`, `page`, `pageSize` (at most 100) |
| `GET /organisations/{id}`    | `registry.organisations.organisation.read`   | with `sameAs`, ROR id; the contact point for administrators                                |
| `POST /organisations`        | `registry.organisations.organisation.manage` | 201; 409 duplicate; 422 unknown type or bad input; audited                                 |
| `PATCH /organisations/{id}`  | `registry.organisations.organisation.manage` | partial; `null` clears an optional field; 404, 409, 422; audited                           |
| `DELETE /organisations/{id}` | `registry.organisations.organisation.manage` | 204; by id only; 409 `organisation-in-use` while `org.usage` counts; audited               |
| `GET /organisation-types`    | `registry.organisations.organisation.read`   | the registered types, labels for `locale`                                                  |

## Operating notes

- A deployment that drops a module which contributed an organisation type keeps the organisations of that type, read-only. Keep the
  module, or delete the organisations.
- `memberCount` is `0` until sprint 3 adds memberships.
- The image of the `registry` profile (`dev-registry`, `<x.y.z>-registry`) holds the core modules and this module.

## Tests

`service/fields.test.ts` and `service/field-rules.test.ts` are table-driven and need no database. `service/organisations.test.ts`
covers every service method against real Postgres, each with a denied case and each write with a rollback case (the outbox is
broken so the event cannot be stored). `service/registries.test.ts` loads a fixture module next to this one that contributes a
`funder` type and an `org.usage` entry, and the failures a bad contribution causes. `module.test.ts` checks the manifest, the prefix
and that there is no enum. The route tests are in `apps/server/src/organisation-routes.test.ts`; the denied cases of every route are in
`defect-01.privilege-escalation.test.ts`.
