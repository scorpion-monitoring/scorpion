# registry.services

The service record: what a research infrastructure offers, with its slug, name, licence, stage, description, URL, `sameAs` links, a
contact point, a provider and any consortia, and the extension points through which other modules add fields, wizard steps,
organisation roles, facets and Schema.org properties. It is the second registry module and the first that other modules extend through
several registries ([ADR-0035](../../docs/adr/0035-service-model.md), [m7-sprint-plan.md](../../docs/m7-sprint-plan.md)).

Status: M7 sprints 1 to 3. Sprint 1: the module, the tables, the five registries, the two config files and their validator, the SPDX
licence list, the service record with `create`, `get`, `getBySlug` and `list`, the trusted reads and the `registry` and `full` profiles.
Sprint 2 ([ADR-0036](../../docs/adr/0036-service-access.md)): the policy `service.member`, the scoped permissions, the three groups of
editors, `update`, the slug rename with its history, the icon, the publication flag and the visibility of the contact point. The
Sprint 3 ([ADR-0036](../../docs/adr/0036-service-access.md) part 2): the Schema.org profile, the anonymous reads of a service and of the organisations it names, and the notice to the provider on a publication. The catalogue (sprint 4) and the screens (sprints 5 and 6) follow.

## Manifest

| Part         | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id           | `registry.services`                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| table prefix | `svc_` (set in the manifest; ADR-0004): `svc_service`, `svc_service_organisation`, `svc_field_value`, `svc_slug_history`, `svc_license_cache`                                                                                                                                                                                                                                                                                                                   |
| dependencies | `core.authz`, `core.settings`, `core.identity`, `core.notifications`, `core.blob`, `registry.organisations` and the package `@scorpion/integrations` (SPDX); `core.ui-shell` as an optional peer (the module starts without the shell). `core.audit` observes it (see "Events")                                                                                                                                                                                 |
| routes       | internal API, see "Routes"                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ui           | none yet (sprint 4 adds the `ui` entry)                                                                                                                                                                                                                                                                                                                                                                                                                         |
| events       | emits `registry.service.created@1`, `.updated@1`, `.slugChanged@1`, `.published@1` and `.unpublished@1`                                                                                                                                                                                                                                                                                                                                                         |
| templates    | `registry.service-publication` (en, de), category `registry-service`: the notice to the provider on a publication                                                                                                                                                                                                                                                                                                                                               |
| registries   | declares `service.orgRole`, `service.fieldType`, `service.wizardStep`, `service.facet`, `service.profileContributor`; contributes the seeds to the first, second and fourth, `org.usage` (registry.organisations), the `usage` of the `stage` vocabulary (core.settings), the public references to `org.publicReference`, the template to `notify.template`, the default roles to `authz.defaultRole` and the policy `service.member` to `authz.resourcePolicy` |
| settings     | `exposeContactPoint` and `allowPublic` (see "Settings"), shown by the generic settings form                                                                                                                                                                                                                                                                                                                                                                     |

### Permissions

| Permission                                | Scope     | Allows                                                                                                                                | Held by default by                                                        |
| ----------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `registry.services.service.read`          | plain     | Read services, search the licence list and list the organisation roles; also what the delegated routes name at the route              | Admin, User, Reviewer                                                     |
| `registry.services.service.create`        | plain     | Create a service. The service then needs an Admin or an approved member of the chosen provider                                        | Admin, User                                                               |
| `registry.services.service.manage`        | plain     | Every field of any service, as Admin; never restricted                                                                                | Admin                                                                     |
| `registry.services.service.publish`       | plain     | Make a service public or private again                                                                                                | Admin, Reviewer                                                           |
| `registry.services.service.edit`          | `service` | Name, licence, stage, description, URL, `sameAs`, the contact point, the icon, the consortia and the configured fields of one service | Admin; the approved **members** (managers too) of that service's provider |
| `registry.services.service.edit-identity` | `service` | The slug and the provider of one service                                                                                              | Admin; the approved **managers** of that service's provider               |
| `registry.services.service.read-contact`  | `service` | Always see the contact point of one service, whatever the setting says                                                                | Admin; the approved members (managers too) of that service's provider     |

Admin holds every declared permission by resolution (ADR-0014); `user` gets `read` and `create`, `reviewer` gets `read` and `publish`
through `authz.defaultRole`. The service checks the permission again on every method (`ctx.authz.require`).

### The policy `service.member` and the three groups (ADR-0036)

The policy loads the service's **provider** from `svc_service_organisation` and asks `registry.organisations`
(`isApprovedMemberAsSystem`, `isManagerAsSystem`) at **every call**: nothing is cached, so a removal, a demotion or a move of the service
is seen at the next call. A requested, rejected or left membership, a membership of another organisation and a consortium grant nothing.

| Group                            | Writes                                                                                                                 |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Approved member of the provider  | name, licence, stage, description, URL, `sameAs`, the contact point, the icon, the consortia and the configured fields |
| Approved manager of the provider | all of those, and the **slug** and the **provider** (a move only to an organisation the manager also manages)          |
| Admin                            | everything                                                                                                             |
| Reviewer and Admin               | the publication flag, and nothing else (a Reviewer is no editor)                                                       |

**Field rules** (`service/field-rules.ts`): `requiredAccess(fields)` returns `identity` for the slug and the provider and `edit` for every
other configured field (a field a deployment adds is an `edit` field); a mixed request needs both; `allows(level, needed)` decides;
`editableFields(level, keys)` draws the same line for `GET /services/{id}`. A request that names a field its caller may not write is
**refused whole**: 403, the problem names the fields ("These fields can only be changed by a manager of the provider or an
administrator: slug.") and never a value, nothing is written and no event is sent. The order is 404, 403, 422.

## The record

`svc_service`: `id` (UUIDv7), `slug` (unique without case), `name`, `license` (an SPDX id), `stage` (a term of the `stage`
vocabulary, no enum), `description` (plain text), `url`, `same_as` (`text[]`, at most 20), `contact_email` and `contact_type` (together
or not at all), `icon_blob_id` and `icon_hash` (sprint 2), `public` with `published_at` and `published_by` (set together; sprint 2),
and the audit columns. `svc_service_organisation`: the organisation id (a plain column, no foreign key) and the role (a key of
`service.orgRole`), unique per service, organisation and role. `svc_field_value`: the values of configured fields that are not columns
(`jsonb`). `svc_slug_history`: every slug a service has had, **the current one included**, unique without case, so a slug is never
reused. `svc_license_cache`: the SPDX list as last fetched. No pg enum and no foreign key to `org_organisation`, to a user or to the
blob table.

A **slug** is letters, digits, `.`, `_` and `-`, at most 64, starting with a letter or digit, **not shaped like a UUID** and not one of
`new`, `facets`, `schema`, `by-slug`, `public`, `edit`. The URL, `sameAs`, description, name and contact rules are the organisation's
(the functions are imported through `registry.organisations/public`, not copied).

## Service layer (`service/services.ts`)

Every method takes the `actor`. `create` (`…service.create`, and an Admin or an approved member of the chosen provider, checked before the
body is parsed; one transaction for the service row, the slug history row, the organisation links, the configured field values and the
event), `get`, `getBySlug` (an old slug answers the current record with `redirectedFrom`, the old slug as it was stored), `list` (`q`, sort by
`name`, `slug` or `stage`, `dir`, pages; ties by id), `searchLicences` and `listRoles` (all need `…service.read`). Sprint 2 adds `update`,
`setIcon`, `clearIcon` and `setPublication`, below. `get` and the methods that return a record also return `editableFields` and
`allowedActions` for the caller. The input of `create` is the **nested form object** the wizard edits: every value is addressed by the JSON pointer
of its field (`/name`, `/contact/type`) and validated by the Zod schema of its field type; an unknown key, a bad value, an unknown
organisation, a wrong organisation type, a missing provider, an unknown stage or an unknown licence is **422** with one entry per field
(never a 500), a taken slug is **409** (`slug-taken`, naming the field only). A create that fails leaves no row in any table.

**`update(actor, id, patch)`** takes a partial nested object: the fields it names change, the others are not touched, `null` clears an
optional field (the contact point as a pair), no default applies, at least one field is needed, the icon and `public` are not fields of
a patch. The row is locked, only the columns that changed are written (two editors on different fields both stick; on one field the last
write wins), the consortia replace the links of their role (by id, scoped to the service), a configured field that is not a column is
upserted into `svc_field_value`, and one transaction holds all of it with the event. Nothing changed means nothing written and no event.

**Slug rename.** Naming a new `slug` writes the old one to `svc_slug_history` (it keeps resolving through `getBySlug` and is never given to
another service) and the new one to the row, in that transaction. A slug the service already holds in the history (a return to an old
one, a change of case) is reused. A clash on either unique index is **409** `slug-taken` naming the field only; two renames to one slug,
and a rename racing a create, are decided by the index: one wins.

**Icon.** `setIcon` and `clearIcon` work as the organisation's logo: the `…service.edit` check runs **before** `blob.put`, so a denied
caller leaves no file; a raster is re-encoded, an SVG sanitised, the limits are the blob store's; `setReference` holds the new file and
releases the old one inside the transaction that also sets the columns and sends the event. The block that shows it is `ImageBlock` in
`packages/ui-kit` (the screen comes in sprint 6).

**Publication.** `setPublication(actor, id, { public })` needs `…service.publish` (Reviewers and Admin; a manager or a member of the provider
gets 403 and sees `public` in the record). It sets `public`, `published_at` and `published_by` together under the row lock; setting the
state the service already has answers 200 without an event; a publication while `allowPublic` is off is **409**; an unpublication is always
allowed.

**Contact point.** In the record only for Admin and the provider's members and managers (the scoped `…service.read-contact`), and for every
other signed-in person while `exposeContactPoint` is on; never in a list row, an event, an audit entry, a log line, a mail or a trusted read.

**Trusted reads** for M8, M9 and M13 on `public.ts`, with the `AsSystem` suffix and no permission check: `findByIdsAsSystem`,
`findBySlugAsSystem`, `listByOrganisationAsSystem`, `existsAsSystem`. They return the descriptive fields and the organisation ids,
never the contact point or the audit columns.

## The Schema.org profile and the public reads (sprint 3)

`service/schema-org.ts` is **pure**: `toSchemaOrg(service, { origin, basePath, organisations, contributors, fields })` builds a Schema.org
`Service`, and the signed-in route, the public route and the page block use only that function. `serializeJsonLd` is registry.organisations'
(`public.ts`): the escape function stays one.

| Stored field                        | Property                                                                                         | Notes                                                                                                                                                                                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (fixed)                             | `@type: Service`                                                                                 |                                                                                                                                                                                                                                                               |
| `id`                                | `@id`                                                                                            | `<origin><base path>/services/<id>`; **stable across a rename**                                                                                                                                                                                               |
| `name`, `slug`                      | `name`, `alternateName`                                                                          |                                                                                                                                                                                                                                                               |
| `description`, `url`, `sameAs`      | `description`, `url`, `sameAs`                                                                   | plain text, `http(s)` URLs; empty ones are left out, never `null`                                                                                                                                                                                             |
| icon                                | `logo`                                                                                           | `ImageObject` under the base path (`/api/internal/files/{hash}`)                                                                                                                                                                                              |
| `license`                           | `license`                                                                                        | `https://spdx.org/licenses/<id>.html`, only for an id the list knows (schema.org has no `license` on `Service`: backlog)                                                                                                                                      |
| provider                            | `provider`                                                                                       | `{ @type, @id, name, url }` from the organisation's profile without a contact point                                                                                                                                                                           |
| consortia                           | `brand`                                                                                          | the same nodes; absent without consortia                                                                                                                                                                                                                      |
| a configured field with `schemaOrg` | `termsOfService`, `areaServed`, `audience` or `slogan`                                           | a string or a list of strings                                                                                                                                                                                                                                 |
| contributors                        | `serviceType`, `category`, `audience`, `areaServed`, `termsOfService`, `slogan`, `serviceOutput` | the allow-list; anything else is dropped (and logged), a contributor can never replace `@id`, `@type`, `name`, `provider` or `license`; the first value for a property wins (configured field, then contributors by id); a contributor that throws is skipped |
| stage, contact point                | **never**                                                                                        | `Service` has neither                                                                                                                                                                                                                                         |

**Public reads** (`getPublicAsSystem(ref)`, `schemaOrgPublicAsSystem(ref)`, `listPublicByOrganisationAsSystem(id)`; trusted, no actor): a service
is public only while its flag `public` is set (Reviewers and Admin set it) **and** `allowPublic` is on. `ref` is an id, a slug or an old slug. The
flag, the record, the organisation links and the configured values are read in **one statement**, so a publication racing a read gives a whole
record or nothing. Everything else is `undefined`, which the route answers with the **same 404 and the same body as an unknown id**, never a 403.
The public record is its own pinned list of fields: `id`, `slug`, `name`, `logoUrl`, `description`, `url`, `sameAs`, `license`, `stage`, `provider` and
`consortia` as `{ id, name, public }`; no contact point, no `editableFields`, no `allowedActions`, no member, no audit column, no `published_*`, no configured value.

The module contributes `org.publicReference`, so `registry.organisations` serves the public profile of an organisation that a public service names.
The routes are in the table below. A 200 says `Cache-Control: public, max-age=60` (the only delay before a shared cache sees an unpublish; the
server keeps none); the page block that uses `JsonLd` (ui-kit) comes with the service page in sprint 6.

**The publication notice.** `setPublication` also writes, in the same transaction, an inbox item (and a mail where the account has an address and has
not switched off the category `registry-service`) to the approved managers of the provider and the creator of the service, read at that moment,
**never** to the person who decided and only to active accounts, from the template `registry.service-publication` (en, de). The mail names the
service and the new state and carries the link `<origin><base path>/services/<id>`; it names nobody and no address but the recipient's own.

## Routes (internal API, `/api/internal`)

| Route                                   | Permission                          | Notes                                                                                                                                                                   |
| --------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /services`                         | `registry.services.service.read`    | `q`, `sort`, `dir`, `page`, `pageSize`; the legacy envelope, 0-based pages; a row has no contact point, description or links                                            |
| `GET /services/{id}`                    | `registry.services.service.read`    | the record with `editableFields` and `allowedActions` for the caller; the contact point only for those the table names                                                  |
| `GET /services/by-slug/{slug}`          | `registry.services.service.read`    | an old slug answers the current record with `redirectedFrom`                                                                                                            |
| `POST /services`                        | `registry.services.service.create`  | `audit: true`, 201; body at most 64 KB; **403 from the service** for a caller who is neither Admin nor a member of the provider; 409 for a taken slug; 422 for the rest |
| `PATCH /services/{id}`                  | `registry.services.service.read`    | **delegated** (ADR-0034): the service decides; `audit: true`; 403 refuses the whole request; 409 `slug-taken`; 422                                                      |
| `PUT /services/{id}/icon`               | `registry.services.service.read`    | **delegated**; the raw image as the body; `strict` rate limit; 403 before any file is stored; 413 above the upload ceiling; 422 for a bad image                         |
| `DELETE /services/{id}/icon`            | `registry.services.service.read`    | **delegated**; 404 when there is no icon                                                                                                                                |
| `PUT /services/{id}/publication`        | `registry.services.service.publish` | `{ public: boolean }`; `audit: true`; 409 when `allowPublic` is off                                                                                                     |
| `GET /services/{id}/schema-org`         | `registry.services.service.read`    | `application/ld+json`, `Cache-Control: private, no-cache`; any service, never the contact point or the stage                                                            |
| `GET /public/services/{ref}`            | **public**                          | the public record by id, slug or old slug; 404 (body of an unknown id) for anything not public; `Cache-Control: public, max-age=60`; `default` rate limit               |
| `GET /public/services/{ref}/schema-org` | **public**                          | the profile of a public service, `application/ld+json`; the same 404 and cache rules                                                                                    |
| `GET /licenses`                         | `registry.services.service.read`    | the SPDX search for the licence field; deprecated ids are marked                                                                                                        |
| `GET /service-roles`                    | `registry.services.service.read`    | the `service.orgRole` entries, for the form                                                                                                                             |

## Configuration (`config/fields.ts`, `config/steps.ts`)

Typed TypeScript, the successors of `service_schema.json` and `steps.json`, validated when the module starts. A **field** has a `key`,
a JSON pointer `path`, a `type` (an entry of `service.fieldType`), `label` and `help` message keys, `required`, an optional `default`,
a type-specific `config`, a `storage` (`column`: a column of `svc_service`; `organisations`: a role of `service.orgRole`; `value`: a key
of `svc_field_value`; `icon`: set by the icon routes of sprint 2) and an optional `schemaOrg` property (`termsOfService`,
`areaServed`, `audience` or `slogan`). A **step** has an `id`, an `order`, a `title` message key, `intro` message keys (the legacy
`texts`) and the keys of its `fields`, or a `component`. The shipped steps are **basics** (slug, name, licence, stage, icon,
description, URL, `sameAs`), **provision** (provider, consortia) and **contact** (the contact point).

The validator (`config/validate.ts`) **refuses to start the server**, with a message that names the file and the field and lists every
problem, for: an unknown field type, two fields with one key or one pointer (or a pointer that is the parent of another), a column
that does not exist or that may not be configured, two fields on one column, a list in a single-valued column (or the reverse), a
storage the type does not support, a bad type config, an unregistered role, a role that needs organisations but has no required field,
a `schemaOrg` outside the allow-list, a default that does not fit, a step that names an unknown field, a field in no step or in two,
a step order or id that clashes, and a step with neither fields nor a component. Steps that other modules contribute pass through the
same function. A change to these files means a rebuild.

## Registries

All five are declared here; the loader validates each entry with Zod and names the contributing module when one is wrong, and only a
module that declares `registry.services` as a dependency may contribute.

| Registry                     | Entry                                                                                                              | This module contributes                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `service.orgRole`            | `{ id, labels, orgTypes, min, max, order }`                                                                        | `provider` (1..1, type `provider`), `consortium` (0..20, type `consortium`) |
| `service.fieldType`          | `{ id, labels, widget, storages, configSchema, schema(config), jsonSchema(config), check?, toValue?, schemaOrg? }` | `text`, `select`, `multi-select`, `license`, `organisation`, `image`        |
| `service.wizardStep`         | `{ id, order, title, intro, fields, component?, applies? }`                                                        | none (its own steps are `config/steps.ts`)                                  |
| `service.facet`              | `{ id, labels, order, emptyLabel?, where(selected), values(scope, db) }`                                           | `consortium`, `stage`, `license`, `provider`                                |
| `service.profileContributor` | `{ id, contribute(service, ctx) }`                                                                                 | none (the Schema.org builder enforces the allow-list)                       |

It also contributes `org.publicReference` (the public services an organisation is named by; see the public reads), `notify.template`, and `org.usage` (an organisation with `svc_service_organisation` rows cannot be deleted and its type cannot change,
the 409 names `registry.services`) and the `usage` of the `stage` vocabulary (a term a service has is deactivated, never deleted).

### How to add a field type, a wizard step, an organisation role, a facet and a profile property

A module contributes by listing `registry.services` as a dependency in its `package.json` and putting entries under `contributes` in
its manifest; nothing in this module changes.

- **A field type** (`service.fieldType`): give `id`, `labels`, the `widget` the UI maps it to, the `storages` it may use, a Zod
  `configSchema` for the config of a field of this type, `schema(config)` (the Zod schema of one value, used in the browser and on the
  server), `jsonSchema(config)` and, when the value refers to other data, `check(value, config, env)` returning `{ problem }`, `{ value }`
  (a canonical form) or nothing. `env` offers `vocabularyHas` and `findLicence`.
- **A wizard step** (`service.wizardStep`): `id`, `order` (not one the config already uses), a `title` message key, `intro` keys and
  `fields` (field definitions as in `config/fields.ts`, with keys and pointers that are not taken), or a `component`. Values of a
  contributed field with `storage: { kind: 'value' }` land in `svc_field_value`.
- **An organisation role** (`service.orgRole`): `id`, `labels`, the `org.type` ids that may take it (they must be registered), `min`
  and `max`; a field with `storage: { kind: 'organisations', role }` writes it.
- **A facet** (`service.facet`): `id`, `labels`, `order`, `where(selected)` and `values(scope, db)`.
- **A profile property** (`service.profileContributor`): `contribute(service, ctx)` returns Schema.org properties; the allow-list
  (`serviceType`, `category`, `audience`, `areaServed`, `termsOfService`, `slogan`, `serviceOutput`) is enforced when the profile is
  built (sprint 3): other names are dropped, and `@id`, `@type`, `name`, `provider` and `license` can never be replaced.

`service/registries.test.ts` is the worked example: a fixture module contributes one of each and loads next to this module, and a wrong
entry of each kind fails at load with the module's name in the message.

## Settings

| Setting              | Default | Effect                                                                                                                                                                                                                                                       |
| -------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `exposeContactPoint` | on      | On: every signed-in person sees a service's contact point. Off: only administrators and the provider's members. Never public, never in a list                                                                                                                |
| `allowPublic`        | on      | On: Reviewers and Admin may make a service public and the public routes answer for public services. Off: a publication is 409 (an unpublication is allowed) and **every public address answers the 404 of an unknown id**, a service that is public included |

## Events

| Event                            | Payload                                                          | Audit                                                           |
| -------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------- |
| `registry.service.created@1`     | `{ serviceId, by: admin \| member, actorId }`                    | logged, not critical (follows `channels.admin`)                 |
| `registry.service.updated@1`     | `{ serviceId, fields, by: admin \| manager \| member, actorId }` | logged, not critical; `by` is the highest group the change used |
| `registry.service.slugChanged@1` | `{ serviceId, actorId }`                                         | **critical**: an address that others link to changed            |
| `registry.service.published@1`   | `{ serviceId, actorId }`                                         | **critical**: it changes who can read the service               |
| `registry.service.unpublished@1` | `{ serviceId, actorId }`                                         | **critical**                                                    |

`fields` are the keys of the configured fields that changed. Ids, `by` and field keys only: never a name, an address or a URL (a test
checks the payloads). `core.audit` lists this module as an optional peer and holds the decisions in `decisions.ts`.

## SPDX licence list

`createSpdx` of `@scorpion/integrations` reads the list with a 5 second timeout and retries, caches it in `svc_license_cache` for 24
hours through the port in `service/licences.ts`, and falls back to the copy that ships with the code. `NODE_ENV=test` uses the stub.
An unknown licence id is 422; a deprecated one is accepted and marked. See the package's README.

## Tests

`pnpm test --filter @scorpion/registry-services` (Docker needed): the registries and the fixture module
(`service/registries.test.ts`), the validator with every failure (`config/validate.test.ts`), field validation (`service/fields.test.ts`,
`field-types.test.ts`, `body.test.ts`), every service method against real Postgres with the real authoriser
(`service/services.test.ts`), the contributions to other registries (`service/usage.test.ts`), the facets, the licence cache and the
manifest rules (no pg enum, every table prefixed, no hard-coded stage or role). The routes through the whole pipeline are in
`apps/server/src/service-routes.test.ts`; the denied cases are in `defect-01.privilege-escalation.test.ts`. Sprint 3: the builder (`service/schema-org.test.ts`: every row of the mapping, the allow-list, hostile text, the output against the schema.org vocabulary), the profile and public reads (`service/profile.test.ts`, `service/public.test.ts`, with a publication racing reads), the notice (`service/publication-notice.test.ts`, `templates/registry.test.ts`), and through the pipeline `apps/server/src/public-service-routes.test.ts` (the identical 404, the cache header, the rate limit, no contact point), `public-records.test.ts` (the pinned fields) and `public-routes-prototype.test.ts`.
