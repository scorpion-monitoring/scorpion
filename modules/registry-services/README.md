# registry.services

The service record: what a research infrastructure offers, with its slug, name, licence, stage, description, URL, `sameAs` links, a
contact point, a provider and any consortia, and the extension points through which other modules add fields, wizard steps,
organisation roles, facets and Schema.org properties. It is the second registry module and the first that other modules extend through
several registries ([ADR-0035](../../docs/adr/0035-service-model.md), [m7-sprint-plan.md](../../docs/m7-sprint-plan.md)).

Status: M7 sprints 1 to 6. Sprint 1: the module, the tables, the five registries, the two config files and their validator, the SPDX
licence list, the service record with `create`, `get`, `getBySlug` and `list`, the trusted reads and the `registry` and `full` profiles.
Sprint 2 ([ADR-0036](../../docs/adr/0036-service-access.md)): the policy `service.member`, the scoped permissions, the three groups of
editors, `update`, the slug rename with its history, the icon, the publication flag and the visibility of the contact point. The
Sprint 3 ([ADR-0036](../../docs/adr/0036-service-access.md) part 2): the Schema.org profile, the anonymous reads of a service and of the organisations it names, and the notice to the provider on a publication. Sprint 4 ([ADR-0035](../../docs/adr/0035-service-model.md) addendum): the catalogue read model with facets over the filtered set, `GET /services/facets`, and the screen `/services`. Sprint 5: the create wizard. Sprint 6: the service page with its edit form and the publication buttons, and the public pages (see "The service page, publication and the public pages"). The release is sprint 7.

## Manifest

| Part         | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id           | `registry.services`                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| table prefix | `svc_` (set in the manifest; ADR-0004): `svc_service`, `svc_service_organisation`, `svc_field_value`, `svc_slug_history`, `svc_license_cache`                                                                                                                                                                                                                                                                                                                   |
| dependencies | `core.authz`, `core.settings`, `core.identity`, `core.notifications`, `core.blob`, `registry.organisations` and the package `@scorpion/integrations` (SPDX); `core.ui-shell` as an optional peer (the module starts without the shell). `core.audit` observes it (see "Events")                                                                                                                                                                                 |
| routes       | internal API, see "Routes"                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ui           | `./ui`: the catalogue `/services`, the wizard `/services/new`, the service page `/services/:slug` and the public page `/public/services/:slug` (see "The catalogue", "The create wizard" and "The service page, publication and the public pages")                                                                                                                                                                                                              |
| events       | emits `registry.service.created@1`, `.updated@1`, `.slugChanged@1`, `.published@1` and `.unpublished@1`                                                                                                                                                                                                                                                                                                                                                         |
| templates    | `registry.service-publication` (en, de), category `registry-service`: the notice to the provider on a publication                                                                                                                                                                                                                                                                                                                                               |
| registries   | declares `service.orgRole`, `service.fieldType`, `service.wizardStep`, `service.facet`, `service.profileContributor`; contributes the seeds to the first, second and fourth, `org.usage` (registry.organisations), the `usage` of the `stage` vocabulary (core.settings), the public references to `org.publicReference`, the template to `notify.template`, the default roles to `authz.defaultRole` and the policy `service.member` to `authz.resourcePolicy` |
| settings     | `exposeContactPoint` and `allowPublic` (see "Settings"), shown by the generic settings form                                                                                                                                                                                                                                                                                                                                                                     |

### Permissions

| Permission                                | Scope     | Allows                                                                                                                                  | Held by default by                                                        |
| ----------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `registry.services.service.read`          | plain     | Read services, search the licence list and list the organisation roles; also what the delegated routes name at the route                | Admin, User, Reviewer                                                     |
| `registry.services.service.create`        | plain     | Create a service. The service then needs an Admin or an approved member of the chosen provider                                          | Admin, User                                                               |
| `registry.services.service.manage`        | plain     | Every field of any service, as Admin; never restricted                                                                                  | Admin                                                                     |
| `registry.services.service.publish`       | plain     | Make a service public or private again                                                                                                  | Admin, Reviewer                                                           |
| `registry.services.v1.read`               | plain     | Read the services through the public API (`GET /api/v1/services`, one service, its Schema.org profile); a token must name it as a scope | Admin, User                                                               |
| `registry.services.service.edit`          | `service` | Name, licence, stage, description, URL, `sameAs`, the contact point, the icon, the consortia and the configured fields of one service   | Admin; the approved **members** (managers too) of that service's provider |
| `registry.services.service.edit-identity` | `service` | The slug and the provider of one service                                                                                                | Admin; the approved **managers** of that service's provider               |
| `registry.services.service.read-contact`  | `service` | Always see the contact point of one service, whatever the setting says                                                                  | Admin; the approved members (managers too) of that service's provider     |

Admin holds every declared permission by resolution (ADR-0014); `user` gets `read`, `create` and `v1.read`, `reviewer` gets `read` and `publish`
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
`findBySlugAsSystem`, `listByOrganisationAsSystem`, `existsAsSystem`, and `listProviderIdsAsSystem()` (M10 sprint 5: the ids of the organisations that are the provider of a service, for a job that walks the providers; `PROVIDER_ROLE` names the role for `listByOrganisationAsSystem`). They return the descriptive fields and the organisation ids,
never the contact point or the audit columns. `isProviderManagerAsSystem` and `isProviderMemberAsSystem` answer a yes or no for a user and a service
(for a module's scoped permission), and `listForPickerAsSystem({ q?, memberOf?, limit })` (M10 sprint 4) lists `{ id, slug, name }` of the services of a search by name or
abbreviation, or, with `memberOf`, of the providers that user is an approved member of: a module's picker uses it and then asks its **own** scoped permission for each row it keeps.

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
server keeps none); the page block that uses `JsonLd` (ui-kit) is on the service page and on the public page (sprint 6).

**The publication notice.** `setPublication` also writes, in the same transaction, an inbox item (and a mail where the account has an address and has
not switched off the category `registry-service`) to the approved managers of the provider and the creator of the service, read at that moment,
**never** to the person who decided and only to active accounts, from the template `registry.service-publication` (en, de). The mail names the
service and the new state and carries the link `<origin><base path>/services/<id>`; it names nobody and no address but the recipient's own.

## Routes (internal API, `/api/internal`)

| Route                                   | Permission                          | Notes                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /services`                         | `registry.services.service.read`    | the catalogue: `q`, repeatable filters by facet id (`consortium`, `stage`, `license`, `provider`, a contributed facet), `sort` (`name`, `slug`, `stage`, `provider`), `dir`, `page`, `pageSize` (at most 100), `locale`; the legacy envelope, 0-based pages; a row has no contact point, description or links; 422 for a filter that names nothing |
| `GET /services/facets`                  | `registry.services.service.read`    | the facets with their values and counts over the set the other facets and the search leave; the same filters and `locale`; all on page 0                                                                                                                                                                                                           |
| `GET /services/schema`                  | `registry.services.service.create`  | the schema of the create wizard: the steps and fields with their widgets and message keys, one JSON Schema per step, the limits, the roles and field types in use, the defaults and `devConsole`; nothing of any person or service; `locale`                                                                                                       |
| `GET /services/{id}`                    | `registry.services.service.read`    | the record with `editableFields` and `allowedActions` for the caller; the contact point only for those the table names                                                                                                                                                                                                                             |
| `GET /services/by-slug/{slug}`          | `registry.services.service.read`    | an old slug answers the current record with `redirectedFrom`                                                                                                                                                                                                                                                                                       |
| `POST /services`                        | `registry.services.service.create`  | `audit: true`, 201; body at most 64 KB; **403 from the service** for a caller who is neither Admin nor a member of the provider; 409 for a taken slug; 422 for the rest                                                                                                                                                                            |
| `PATCH /services/{id}`                  | `registry.services.service.read`    | **delegated** (ADR-0034): the service decides; `audit: true`; 403 refuses the whole request; 409 `slug-taken`; 422                                                                                                                                                                                                                                 |
| `PUT /services/{id}/icon`               | `registry.services.service.read`    | **delegated**; the raw image as the body; `strict` rate limit; 403 before any file is stored; 413 above the upload ceiling; 422 for a bad image                                                                                                                                                                                                    |
| `DELETE /services/{id}/icon`            | `registry.services.service.read`    | **delegated**; 404 when there is no icon                                                                                                                                                                                                                                                                                                           |
| `PUT /services/{id}/publication`        | `registry.services.service.publish` | `{ public: boolean }`; `audit: true`; 409 when `allowPublic` is off                                                                                                                                                                                                                                                                                |
| `GET /services/{id}/schema-org`         | `registry.services.service.read`    | `application/ld+json`, `Cache-Control: private, no-cache`; any service, never the contact point or the stage                                                                                                                                                                                                                                       |
| `GET /public/services/{ref}`            | **public**                          | the public record by id, slug or old slug; 404 (body of an unknown id) for anything not public; `Cache-Control: public, max-age=60`; `default` rate limit                                                                                                                                                                                          |
| `GET /public/services/{ref}/schema-org` | **public**                          | the profile of a public service, `application/ld+json`; the same 404 and cache rules                                                                                                                                                                                                                                                               |
| `GET /licenses`                         | `registry.services.service.read`    | the SPDX search for the licence field; deprecated ids are marked                                                                                                                                                                                                                                                                                   |
| `GET /service-roles`                    | `registry.services.service.read`    | the `service.orgRole` entries, for the form                                                                                                                                                                                                                                                                                                        |

### The v1 routes for services (M8 sprint 2, ADR-0037)

Permission `registry.services.v1.read` (granted to `user` by default) for all three routes. A service that is not public is returned like any other
(the token owner may read it internally); the row says so with `public`. Never the contact point.

**`GET /api/v1/services`** (list row). Query: `page`, `pageSize` (default and maximum 100; more is 422), and the filters `service` and `provider` (abbreviations,
comma-separated, case-insensitive, at most 50; an unknown abbreviation is 422), `stage`, `license` (comma-separated like the others; an unknown value is 422 and `:none` is refused) and `category` (names of KPI sets, comma-separated, without case,
at most 50; M9 sprint 3: it is 422 in a profile without a module that contributes a facet with `v1.field: 'category'`). An unknown
parameter is a 422. Sorted by abbreviation (without case), then id. Shaped after the legacy `Service`: the same names and types, plus
`category` (the name of the service's KPI set; `null` for a service without one and in a profile without KPI sets), added in M9 sprint 3.

| Field          | Type                  | Source                                                                                                                 |
| -------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `id`           | string (UUID)         | `svc_service.id` (new; the legacy row has none)                                                                        |
| `abbreviation` | string                | the current `slug`                                                                                                     |
| `name`         | string                | `name`                                                                                                                 |
| `stage`        | string                | the key of a term of the `stage` vocabulary (never its label)                                                          |
| `license`      | string or null        | an SPDX id                                                                                                             |
| `public`       | boolean               | `public` (new)                                                                                                         |
| `provider`     | string or null        | the abbreviation of the organisation with the role `provider`                                                          |
| `consortia`    | string[]              | the abbreviations of the organisations with the role `consortium`, by name then id; `[]` for none; one row per service |
| `providerId`   | string (UUID) or null | the id of that organisation (new), the same id as `id` of `GET /providers`                                             |
| `consortiaIds` | string[]              | the ids of the consortia, in the same order as `consortia` (new)                                                       |

**`GET /api/v1/services/{id}`** (record) is the list row plus:

| Field         | Type           | Source        |
| ------------- | -------------- | ------------- |
| `description` | string or null | `description` |
| `url`         | string or null | `url`         |
| `sameAs`      | string[]       | `same_as`     |

**`GET /api/v1/services/{id}/schema-org`**: the Schema.org `Service` profile as `application/ld+json`, built by the same function and serialised by the
same `serializeJsonLd` as the internal route, so the properties are the internal ones (`name`, `alternateName`, `description`, `url`, `sameAs`, `logo`,
`license`, `provider`, `brand`, and the contributed properties); no contact point, no stage.

Left out of the internal reads, and why:

| Internal field                                     | Why it is not in v1                                                                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `contactEmail`, `contactType`                      | never in v1 (decision of the maintainer)                                                                            |
| `slug`                                             | one name: the legacy `abbreviation` carries it                                                                      |
| `organisations` (all roles)                        | replaced by `provider` and `consortia`; a role nobody registered as owner or consortium is not part of the contract |
| `iconUrl`                                          | a path below `/api/internal/files`, not part of v1 (the Schema.org profile has the logo as it always had)           |
| `values` (configured fields)                       | an open shape that M9 fills with categories; additive later through their own v1 routes                             |
| `redirectedFrom`                                   | belongs to the by-slug read, which v1 has not                                                                       |
| `editableFields`, `allowedActions`                 | hints for the screens, about the caller                                                                             |
| `createdAt`, `updatedAt`, `createdBy`, `updatedBy` | audit columns; not legacy fields; additive later                                                                    |

## The catalogue (sprint 4)

`service/catalogue.ts` is the read model of the screen: a tested query function, not a view (defect 2). `list(actor, query, page, locale)`
returns the page of rows and the total, `facets(actor, query, locale)` the facets. A service is one row whatever its number of consortia
(none, one or many), and the order is the sort key, then the id.

- **Facets count over the filtered set.** Each facet counts over the services that the search and _all the other_ facets leave: OR within a
  facet, AND across facets. A value with no service in that set is shown with count 0 only when it is chosen. The services with no value
  are the value `:none`, labelled by the entry's `emptyLabel` (`Unknown` for a licence); a facet without one has no such value.
- **A filter that names nothing is 422**: a facet nobody registered, an organisation that does not exist, a stage term nobody declared, a
  licence SPDX does not list, `:none` for a facet without an `emptyLabel`, a value over 100 characters or more than 50 values.
- **Labels** come with the answer: the organisation's name, the stage term's label for the `locale` asked for, the licence id. The screen
  names none of them.
- **The screen** (`/services`, `…service.read`, a link in the main section of the navigation): a table (icon, name, provider, consortia as
  badges, stage as text) with server-side sort and pages of 10, 20 and 50, the facets with their counts, the chosen filters as badges that
  a click removes, the search, and the empty state. The search, the filters, the sort and the page live in the address
  (`?q=…&f.stage=PROD&sort=provider&dir=desc&page=1`); a change of the search, a filter, the sort or the page size goes back to the first
  page. The link to a service page and to the wizard appear only when those pages are offered (`ui/offered.ts`) and, for the wizard, when
  the API says the caller may create.

## The create wizard (sprint 5)

`/services/new` (`…service.create`) is a wizard over the steps of the configuration and of the registry `service.wizardStep`. It draws
itself from `GET /services/schema` and holds no field, step, limit or type of its own.

- **The schema route** (`service/create-schema.ts`, a pure function of the resolved configuration, the registries and the options the service
  resolved) answers the steps in order (this module's and the contributed ones; `applies` is a function and is **not** sent), for each field its
  key, JSON pointer, field type, widget, label and help message keys, `required`, `default`, `config`, the role of an organisation field, the
  options of a choice field and whether the value is `deferred` (the icon), **one JSON Schema per step**, the named limits, the
  roles with their bounds, the field types in use, the `defaults` object (generated from the fields: a `default`, `[]` for a list) and
  `devConsole`. It names `…service.create` because the wizard is its only reader; it holds nothing of any person or service.
- **One generator, no drift.** The JSON Schema of a field is `fieldType.jsonSchema(config)`, the Zod schema the server validates with is
  `fieldType.schema(config)` of the same entry; `service/create-schema.test.ts` feeds both the same table of bodies (bounds, patterns,
  the pair rule of the contact point, a key nobody knows, the icon) and fails when their verdicts differ. A value only the server can judge
  because it needs data (a licence, a stage, a reserved slug) is marked in the table: the browser lets it through and the server answers 422
  on the field. The browser never refuses what the server accepts. The browser's checker is `@scorpion/ui-kit/json-schema` (the keywords the
  generated schemas use; a keyword it cannot check is reported, never skipped).
- **The form** is one nested object addressed by the fields' JSON pointers (a Svelte 5 `$state` object bound through `SchemaField`; no store
  library, Decision 21). `ui/form-state.ts` holds the pure rules: the body the form sends (texts trimmed, an emptied optional field left out,
  an emptied list `[]`, a contact point with no part left out, the icon never), the check of a step with its JSON Schema, which step shows
  an error, and what a failed request puts on which field. Each step is checked before the person goes on; `POST /services` is called once for
  the whole object, and a failure shows the field errors, goes to the first step that has one and loses nothing. A reload or a link asks first.
- **Widgets.** The page maps a field type's `widget` name to a control through one table (`ui/widgets.ts`): `text` (the form's own control:
  a line, a paragraph for the `description` format, a list of lines), `select` (the options come with the field: the active terms of a
  vocabulary in the person's language, or the config's list), `multi-select`, `license` (a search of `GET /licenses`; "OSI approved" and
  "deprecated" in words), `organisation` (below) and `image` (a note: the icon is uploaded after the service exists, because the stored file
  refers to the service's id; the screen after the creation offers `ImageBlock`). A widget nobody registered is **not** skipped: the field is
  replaced by an error, the step cannot be left, and `wizard-page.test.ts` fails for a seeded type without a widget.
- **Organisations.** The loader asks the API: for the owning role (`memberOnly` in the schema) the caller's approved memberships of the role's
  types, for an administrator (who holds `…service.manage`) and for every other role all organisations of the role's types. Nothing is guessed
  from a role in the browser, and the server checks the choice again (403 for a provider the caller is not a member of, 422 for an unknown
  organisation). The lists are cut at 100 rows and the field says so.
- **Words.** The labels of the owning and group fields are "Operated by" and "Part of" (`Betrieben von`, `Gehört zu`): the messages of a screen
  name no role (`ui.test.ts` fails on the words "provider" and "consortium"). A stage is the vocabulary's label. The config's keys need real
  texts in both languages (`ui.test.ts`). A 409 for the slug is shown on the slug field in the catalogue's words, without the value.
- **The JSON console** is a textarea beside the wizard, edited in both directions through the same object and checked like a field edit (the
  step schemas, plus a key no field owns). It exists only when the schema says `devConsole: true`, which the server derives from
  `NODE_ENV !== 'production'` when it starts; the page does not draw it otherwise, so a production page has no console in its DOM.
- **Another module** adds a step through the registry, a field type with its widget name, and, for the browser, the control and the condition
  of its step and a section of the service page through the **fourth export of its `ui` entry**, `wizardExtensions: { widgets, applies,
sections }` (ADR-0040 addendum). The shell forwards it once per process (`apps/web/src/lib/wizard-extensions.ts`) to the registry in
  `@scorpion/ui-kit` (`wizard-extensions.ts`, which `ui/wizard-extensions.ts` re-exports), so nothing here depends on a module that a profile
  may leave out; the fixture of the page tests goes through the same forwarding. A step or a field that must be hidden for some forms uses
  the serialisable **`showIf`** (below), which the server asks as well; `applies` stays a browser-only function.
- **`showIf`** on a field or a contributed step: `{ path: '/pointer', equals }` or `{ path, oneOf: [...] }` (a deep comparison on the form
  as sent). A field or step that the form hides is not required and its value is dropped by the server (`service/body.ts`, one function
  for both); the schema sends the condition with the field and the step, and the browser asks the same question (`ui/form-state.ts`).
  The step's JSON Schema leaves a field with a condition out of `required`, so the browser is looser than the server there and the server's
  422 lands on the field. The start refuses a condition that asks about a pointer no field has. A condition governs the create wizard; a
  patch of a stored service is unaffected.

## The service page, publication and the public pages (sprint 6)

Sprint 6 adds **no route**: the pages use the routes of the table above. The page draws what the API says and decides nothing; every button comes from
`allowedActions` and every form field from `editableFields`, never from a role ([ADR-0036](../../docs/adr/0036-service-access.md) part 3).

**Screens and routes**

| Page                        | Needs                          | Loads                                                                                                                                                                         | Draws                                                                                                                                                                                            |
| --------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/services/:slug`           | `…service.read`                | `GET /services/by-slug/{slug}` (or `/services/{id}`), `/services/{id}/schema-org`, `/services/schema`, `/licenses`; for the form `GET /account/memberships`, `/organisations` | the record in words, the Schema.org block in the head, Edit, Make public / Make private, the edit form. An id and an old slug redirect to the current address (thrown by the load)               |
| `/public/services/:slug`    | nobody (public, with a reason) | `GET /public/services/{ref}` and its `/schema-org`                                                                                                                            | the public record, its Schema.org block, who operates it and what it is part of as links to their public pages. Nothing from a session or a role; a record that is not public is the shell's 404 |
| `/public/organisations/:id` | nobody (public, with a reason) | `GET /public/organisations/{id}` and its `/schema-org` (registry.organisations)                                                                                               | the public organisation and its public services as links; the same rules                                                                                                                         |

**The service page.** The stage is the label of its vocabulary term (the options `GET /services/schema` sends with the stage field), the licence is
its name from the SPDX list, the contact point is drawn only when the API returned it (`exposeContactPoint`, the group of the caller), and every link
carries `rel="noopener noreferrer"`. A "Public" or "Private" badge says in words who can read it.

**Edit mode** (`ServiceEdit.svelte`) draws the fields of the schema whose key is in `editableFields`, with the widgets and helpers of the wizard
(`form-state.ts`, `widgets.ts`, `field-node.ts`). The fields of the schema the caller may not write (the short name and the owner, for a member) are shown as
text with "Only a manager of the provider or an administrator can change these." (the owning role's label comes from the server). A save sends only what
changed (`edit-state.ts`, `patchBody`): an emptied optional field is `null`, an emptied list `[]`, the contact point travels as the pair (both `null` clears
it), the icon never; a save button exists only when something changed. The owner field offers only the organisations the caller manages (an administrator:
all of the role's types); the groups offer all organisations of their types, because a member may change them. The icon block is ui-kit's `ImageBlock`
(`PUT`/`DELETE /services/{id}/icon`). A 403 (the page is out of date) is shown in words and keeps what was typed; a 409 for the short name is on its field,
without the value; a 422 is on the fields it names. A rename goes to the new address and says that the old one still works.

**Publication.** Reviewer and Admin get Make public / Make private (from `allowedActions`) with a confirm that says what it means: anyone, signed in or
not, can then read the name, description, links and who operates the service and what it is part of; the contact point is never public. The state changes
in place and the focus goes to the line that says what happened. With `service.allowPublic` off the API offers no Make public; a page that was open
meets the 409, says so in words and disables the button with the reason. Switching the setting off also turns every public page and public route into
a 404 at once (services marked public are served again when it is switched on).

**The public pages** are listed in `PUBLIC_PAGES` of `core.ui-shell`, each with its reason in `ui.routes`. They call only public routes, draw no
control and no field of a person, and are the same page for every visitor (`apps/web/src/service-page.test.ts` renders them with a harness in which reading
the session throws). The stage is shown as its term, because the vocabulary labels are not public (backlog).

**Schema.org on the pages.** Both pages render the profile with `JsonLd` (ui-kit), the one audited `{@html}`, from `serializeJsonLd`: the loader asks the profile
route, the page never builds the string. The mapping is the table in "The Schema.org profile and the public reads"; the signed-in profile
(`GET /services/{id}/schema-org`) never carries the contact point or the stage, and the public one is the same builder over the public record.

**How a profile adds the module.** List `@scorpion/registry-services` in the profile's modules (`profiles/*.ts`), run `pnpm scorpion profile:generate <name>`
(it writes the table of pages and of messages of the web app) and rebuild the image. The `registry` and `full` profiles have it; `core-only` does not, and
then `/services`, the public pages and the routes do not exist. A profile property that tunes the module is a setting (`exposeContactPoint`,
`allowPublic`), not a build option.

## Configuration (`config/fields.ts`, `config/steps.ts`)

Typed TypeScript, the successors of `service_schema.json` and `steps.json`, validated when the module starts. A **field** has a `key`,
a JSON pointer `path`, a `type` (an entry of `service.fieldType`), `label` and `help` message keys, `required`, an optional `default`,
a type-specific `config`, a `storage` (`column`: a column of `svc_service`; `organisations`: a role of `service.orgRole`; `value`: a key
of `svc_field_value`; `icon`: set by the icon routes of sprint 2; `module`: written by the field type's own `store` in the create
transaction, for a module that keeps the value in its own tables), an optional `showIf` and an optional `schemaOrg` property (`termsOfService`,
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

| Registry                     | Entry                                                                                                                                | This module contributes                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `service.orgRole`            | `{ id, labels, orgTypes, min, max, order }`                                                                                          | `provider` (1..1, type `provider`), `consortium` (0..20, type `consortium`) |
| `service.fieldType`          | `{ id, labels, widget, storages, configSchema, schema(config), jsonSchema(config), choices?, check?, store?, toValue?, schemaOrg? }` | `text`, `select`, `multi-select`, `license`, `organisation`, `image`        |
| `service.wizardStep`         | `{ id, order, title, intro, fields, component?, applies?, showIf? }`                                                                 | none (its own steps are `config/steps.ts`)                                  |
| `service.facet`              | `{ id, labels, order, emptyLabel?, where(selection, serviceId), values(matching, db), unknownOf?, labelsOf?, v1? }`                  | `consortium`, `stage`, `license`, `provider`                                |
| `service.profileContributor` | `{ id, contribute(service, ctx) }`                                                                                                   | none (the Schema.org builder enforces the allow-list)                       |

It also contributes `org.publicReference` (the public services an organisation is named by; see the public reads), `notify.template`, and `org.usage` (an organisation with `svc_service_organisation` rows cannot be deleted and its type cannot change,
the 409 names `registry.services`) and the `usage` of the `stage` vocabulary (a term a service has is deactivated, never deleted).

### How to add a field type, a wizard step, an organisation role, a facet and a profile property

A module contributes by listing `registry.services` as a dependency in its `package.json` and putting entries under `contributes` in
its manifest; nothing in this module changes.

- **A field type** (`service.fieldType`): give `id`, `labels`, the `widget` the UI maps it to, the `storages` it may use, a Zod
  `configSchema` for the config of a field of this type, `schema(config)` (the Zod schema of one value, used in the browser and on the
  server), `jsonSchema(config)` (the same rules as the browser's schema: the agreement test of `create-schema.test.ts` shows where they
  differ), `choices(config, env)` for a choice field (the options the schema route sends with it) and, when the value refers to other data,
  `check(value, config, env)` returning `{ problem }`, `{ value }` (a canonical form) or nothing. `env` offers `vocabularyHas` and
  `findLicence`. The `widget` name needs a control in the browser: this module's six are in `ui/widgets.ts`; a contributed one is registered
  with `registerFieldWidget(name, component)` (`ui/wizard-extensions.ts`), and a page that lacks it says so and cannot be completed.
- **A wizard step** (`service.wizardStep`): `id`, `order` (not one the config already uses), a `title` message key, `intro` keys and
  `fields` (field definitions as in `config/fields.ts`, with keys and pointers that are not taken), or a `component`. Values of a
  contributed field with `storage: { kind: 'value' }` land in `svc_field_value`. The step appears in the schema in its order, with its
  fields' JSON Schema; its values are validated by the type's own `schema` and `check` on the server, and a failure in any of them, also
  inside the transaction, leaves no service, link, value or event. `applies(form)` is a function the browser asks (`registerStepApplies`);
  the server ignores it and the schema route does not send it. A field with `storage: { kind: 'module' }` (its type must have a `store`)
  is written by `store(tx, { serviceId, value, config, actorId })` inside the create transaction, after the service row and before the
  `registry.service.created@1` event: the module's rows and the service commit or roll back together. A patch that names such a field is
  422 (the module has its own route for it); `GET /services/schema` sends it like any field.
- **An organisation role** (`service.orgRole`): `id`, `labels`, the `org.type` ids that may take it (they must be registered), `min`
  and `max`; a field with `storage: { kind: 'organisations', role }` writes it.
- **A facet** (`service.facet`): `id`, `labels`, `order`, `emptyLabel` for the services with no value, `where(selection, serviceId)` and
  `values(matching, db)`; neither names a table of this module (ADR-0035 addendum). For a value kept in `svc_field_value` (a text or a
  list of texts) call `fieldValueFacet(id, fieldKey, { labels, order, emptyLabel?, labelsOf? })` from `@scorpion/registry-services/public`.
  The facet then is a filter of `GET /services` under its id and a facet of `GET /services/facets` with no further change. With
  `v1: { field: 'category', valuesOf(serviceIds, db), keysOf(names, db) }` the facet also adds `category` to the rows of the public API
  (`GET /api/v1/services`, additive) and a `category` filter that takes the names `keysOf` knows; without such a facet `category` is `null`
  and the filter is 422. `field` is an allow-list (today only `category`), so a module cannot add an arbitrary key to a v1 row.
- **A rule about the provider's managers** (a permission scoped to `service` of another module): ask `isProviderManagerAsSystem(userId,
serviceId)` of `@scorpion/registry-services/public` in an `authz.resourcePolicy` entry of that module, so the rule of ADR-0036 is written
  once. `kpi.framework` does it for `kpi.framework.service.kpis.edit`.
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
manifest rules (no pg enum, every table prefixed, no hard-coded stage or role). Sprint 4: the conditions of the catalogue as plain functions (`service/catalogue-condition.test.ts`), the catalogue against Postgres with a contributed facet and 300 generated services (`service/catalogue.test.ts`), the browser half (`ui/*.test.ts`, `apps/web/src/catalogue-page.test.ts`) and, in `apps/server/src`, the defect-2 regression test `defect-02.service-consortium.test.ts`. Journey 2 and its axe and keyboard runs are `apps/web/e2e/services.spec.ts` and `accessibility-services.spec.ts`. Sprint 6: the pure edit form (`ui/edit-state.test.ts`), the loaders of the service page and the public page (`ui/service-loaders.test.ts`), the pages rendered on the server (`apps/web/src/service-page.test.ts`: the buttons from `allowedActions`, the fields from `editableFields`, the public pages with no session), journeys 3 to 6 in `services.spec.ts` and the axe and keyboard runs in `accessibility-service-page.spec.ts`. The routes through the whole pipeline are in
`apps/server/src/service-routes.test.ts`; the denied cases are in `defect-01.privilege-escalation.test.ts`. Sprint 3: the builder (`service/schema-org.test.ts`: every row of the mapping, the allow-list, hostile text, the output against the schema.org vocabulary), the profile and public reads (`service/profile.test.ts`, `service/public.test.ts`, with a publication racing reads), the notice (`service/publication-notice.test.ts`, `templates/registry.test.ts`), and through the pipeline `apps/server/src/public-service-routes.test.ts` (the identical 404, the cache header, the rate limit, no contact point), `public-records.test.ts` (the pinned fields) and `public-routes-prototype.test.ts`.
