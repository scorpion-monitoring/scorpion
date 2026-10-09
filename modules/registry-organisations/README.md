# registry.organisations

The organisation record: providers, consortia and whatever other types a module adds, with a plain-text description, website, `sameAs`
links, ROR id and a contact point. It is the first module that is not a `core.*` module, so it also sets the conventions that the
later registry modules copy: a package that depends on the core modules, registries of its own that other modules contribute to,
events that `core.audit` decides on, and a profile that is not `core-only`
([ADR-0032](../../docs/adr/0032-registry-profile.md), [ADR-0033](../../docs/adr/0033-organisation-model.md),
[m6-sprint-plan.md](../../docs/m6-sprint-plan.md)).

Status: M6 sprint 2 (the organisation record, its Schema.org profile and its logo). Membership (sprint 3) and the screens
(sprints 4 and 5) follow.

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
| settings     | `organisation.exposeContactPoint` (boolean, default on), shown by the generic settings form; the membership limits arrive in sprint 3                        |

### Permissions

| Permission                                         | Allows                                                                 | Held by default by    |
| -------------------------------------------------- | ---------------------------------------------------------------------- | --------------------- |
| `registry.organisations.organisation.read`         | Read organisations and the registered types                            | Admin, User, Reviewer |
| `registry.organisations.organisation.manage`       | Create, change and delete organisations, and set or remove their logo  | Admin                 |
| `registry.organisations.organisation.read-contact` | Always see the contact point of an organisation (scope `organisation`) | Admin                 |

Admin holds every declared permission by resolution (ADR-0014); `user` and `reviewer` get `read` through `authz.defaultRole`. The
service checks the permission again on every method (`ctx.authz.require`). In sprint 4 `PATCH /organisations/{id}` and the logo
routes switch their route permission to `…organisation.read` and the service decides, so that the managers of an organisation can edit
the descriptive fields (ADR-0033, Decision 14); `POST` and `DELETE` keep `manage`.

`…read-contact` is **scoped** to the resource type `organisation`: Admin holds it everywhere (by resolution), and the policy of
sprint 3 will add the managers of that organisation. No role holds it by default, so today the contact point is shown by this
permission (Admin) or by the setting below. It was declared now, so sprint 3 adds a policy answer and the service stays as it is.

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
`…organisation.read-contact` on that organisation (administrators; their managers from sprint 3), and to every other signed-in person
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

## The public service

`public.ts` exports the registries' names and entry shapes and `OrganisationsPublic`, the reads for M7 and M8. They are **trusted**:
they check no permission and name no caller (ADR-0015, hence the `AsSystem` suffix), so a route that uses one checks its own
permission first. They return the descriptive fields only (`OrganisationRecord`): never the contact point, the audit columns or the
logo hash.

| Method                                           | Returns                                                              |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| `findByIdsAsSystem(ids)`                         | the records of the known ids (unknown and malformed ids are ignored) |
| `findByAbbreviationAsSystem(type, abbreviation)` | one record or `undefined`; case-insensitive, within the type         |
| `existsAsSystem(id)`                             | `boolean`                                                            |
| `listTypesAsSystem()`                            | the registered types, labels in English                              |
| `toSchemaOrgAsSystem(id, { includeContact? })`   | the profile or `undefined`; `includeContact` defaults to `false`     |

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

`fields` holds the names of the changed fields (`description`, `sameAs`, `rorId`, `contact`, `logo`, ...), never their values (a test
checks the payload: no address, no URL, no hash); `by` is `admin` (and `manager`
from sprint 4). `core.audit` has a decision for each and lists this module as an optional peer. The routes with `audit: true` also
write an entry in the request log.

## Routes

Internal API (`/api/internal`). Lists use the legacy envelope (`metadata`, `result`, 0-based pages) with a stable sort. Invalid input
is 422 problem+json; nothing the caller sends becomes a 500. There is no public route in M6.

| Route                                | Permission                                   | Notes                                                                                      |
| ------------------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `GET /organisations`                 | `registry.organisations.organisation.read`   | `q` (abbreviation or name, `%` `_` `\` are text), `type`, `page`, `pageSize` (at most 100) |
| `GET /organisations/{id}`            | `registry.organisations.organisation.read`   | with `sameAs`, ROR id, `logoUrl`; the contact point as in "The contact point"              |
| `GET /organisations/{id}/schema-org` | `registry.organisations.organisation.read`   | `application/ld+json`, `Cache-Control: private, no-cache`; 404, 422; no anonymous access   |
| `PUT /organisations/{id}/logo`       | `registry.organisations.organisation.manage` | raw image body; 413, 422, 404; strict rate limit; audited                                  |
| `DELETE /organisations/{id}/logo`    | `registry.organisations.organisation.manage` | 404 when there is no logo; audited                                                         |
| `POST /organisations`                | `registry.organisations.organisation.manage` | 201; 409 duplicate; 422 unknown type or bad input; audited                                 |
| `PATCH /organisations/{id}`          | `registry.organisations.organisation.manage` | partial; `null` clears an optional field; 404, 409, 422; audited                           |
| `DELETE /organisations/{id}`         | `registry.organisations.organisation.manage` | 204; by id only; 409 `organisation-in-use` while `org.usage` counts; audited               |
| `GET /organisation-types`            | `registry.organisations.organisation.read`   | the registered types, labels for `locale`                                                  |

## Operating notes

- A deployment that drops a module which contributed an organisation type keeps the organisations of that type, read-only. Keep the
  module, or delete the organisations.
- `memberCount` is `0` until sprint 3 adds memberships.
- The image of the `registry` profile (`dev-registry`, `<x.y.z>-registry`) holds the core modules and this module.

## Tests

`service/fields.test.ts` and `service/field-rules.test.ts` are table-driven and need no database. `service/organisations.test.ts`
covers every service method against real Postgres, each with a denied case and each write with a rollback case (the outbox is
broken so the event cannot be stored). `service/registries.test.ts` loads a fixture module next to this one that contributes a
`funder` type and an `org.usage` entry, and the failures a bad contribution causes. `service/schema-org.test.ts` is table-driven (the mapping, `/` and `/a/b`, hostile text). `service/profile.test.ts` covers the profile,
the contact point matrix and the trusted reads; `service/logo.test.ts` the upload, replacement, removal and the rollback cases.
`module.test.ts` checks the manifest, the prefix and that there is no enum. The route tests are in `apps/server/src/organisation-routes.test.ts`; the denied cases of every route are in
`defect-01.privilege-escalation.test.ts`.
