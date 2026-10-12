# registry.services

The service record: what a research infrastructure offers, with its slug, name, licence, stage, description, URL, `sameAs` links, a
contact point, a provider and any consortia, and the extension points through which other modules add fields, wizard steps,
organisation roles, facets and Schema.org properties. It is the second registry module and the first that other modules extend through
several registries ([ADR-0035](../../docs/adr/0035-service-model.md), [m7-sprint-plan.md](../../docs/m7-sprint-plan.md)).

Status: M7 sprint 1 (the module, the tables, the five registries, the two config files and their validator, the SPDX licence list, the
service record with `create`, `get`, `getBySlug` and `list`, the trusted reads, the routes below and the `registry` and `full`
profiles). The access rules for members and managers, `update`, the slug rename, the icon and the publication flag (sprint 2), the
Schema.org profile and the public reads (sprint 3), the catalogue (sprint 4) and the screens (sprints 5 and 6) follow.

## Manifest

| Part         | Value                                                                                                                                                                                                                                                                                                                 |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id           | `registry.services`                                                                                                                                                                                                                                                                                                   |
| table prefix | `svc_` (set in the manifest; ADR-0004): `svc_service`, `svc_service_organisation`, `svc_field_value`, `svc_slug_history`, `svc_license_cache`                                                                                                                                                                         |
| dependencies | `core.authz`, `core.settings`, `core.identity`, `core.notifications`, `core.blob`, `registry.organisations` and the package `@scorpion/integrations` (SPDX); `core.ui-shell` as an optional peer (the module starts without the shell). `core.audit` observes it (see "Events")                                       |
| routes       | internal API, see "Routes"                                                                                                                                                                                                                                                                                            |
| ui           | none yet (sprint 4 adds the `ui` entry)                                                                                                                                                                                                                                                                               |
| events       | emits `registry.service.created@1`                                                                                                                                                                                                                                                                                    |
| registries   | declares `service.orgRole`, `service.fieldType`, `service.wizardStep`, `service.facet`, `service.profileContributor`; contributes the seeds to the first, second and fourth, `org.usage` (registry.organisations), the `usage` of the `stage` vocabulary (core.settings) and the default roles to `authz.defaultRole` |
| settings     | `exposeContactPoint` and `allowPublic` (see "Settings"), shown by the generic settings form                                                                                                                                                                                                                           |

### Permissions

| Permission                         | Allows                                                                             | Held by default by    |
| ---------------------------------- | ---------------------------------------------------------------------------------- | --------------------- |
| `registry.services.service.read`   | Read services, search the licence list and list the organisation roles             | Admin, User, Reviewer |
| `registry.services.service.manage` | Create services (sprint 2 adds the member rules, `update` and the identity fields) | Admin                 |

Admin holds every declared permission by resolution (ADR-0014); `user` and `reviewer` get `read` through `authz.defaultRole`. The
service checks the permission again on every method (`ctx.authz.require`). Sprint 2 adds the scoped permissions (`edit`,
`edit-identity`, `read-contact`), `create` and `publish`, and the policy `service.member` (ADR-0036); sprint 1 has no scoped
permission.

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

Every method takes the `actor`. Sprint 1: `create` (`…service.manage`; one transaction for the service row, the slug history row, the
organisation links, the configured field values and the event), `get`, `getBySlug` (an old slug answers the current record with
`redirectedFrom`), `list` (`q`, sort by `name`, `slug` or `stage`, `dir`, pages; ties by id), `searchLicences` and `listRoles` (all need
`…service.read`). The input of `create` is the **nested form object** the wizard edits: every value is addressed by the JSON pointer
of its field (`/name`, `/contact/type`) and validated by the Zod schema of its field type; an unknown key, a bad value, an unknown
organisation, a wrong organisation type, a missing provider, an unknown stage or an unknown licence is **422** with one entry per field
(never a 500), a taken slug is **409** (`slug-taken`, naming the field only). A create that fails leaves no row in any table.

**Trusted reads** for M8, M9 and M13 on `public.ts`, with the `AsSystem` suffix and no permission check: `findByIdsAsSystem`,
`findBySlugAsSystem`, `listByOrganisationAsSystem`, `existsAsSystem`. They return the descriptive fields and the organisation ids,
never the contact point or the audit columns.

## Routes (internal API, `/api/internal`)

| Route                          | Permission                         | Notes                                                                                                                        |
| ------------------------------ | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `GET /services`                | `registry.services.service.read`   | `q`, `sort`, `dir`, `page`, `pageSize`; the legacy envelope, 0-based pages; a row has no contact point, description or links |
| `GET /services/{id}`           | `registry.services.service.read`   | the record; the contact point only for those the setting and the role allow                                                  |
| `GET /services/by-slug/{slug}` | `registry.services.service.read`   | an old slug answers the current record with `redirectedFrom`                                                                 |
| `POST /services`               | `registry.services.service.manage` | `audit: true`, 201; body at most 64 KB; 409 for a taken slug; 422 for everything that refers to nothing                      |
| `GET /licenses`                | `registry.services.service.read`   | the SPDX search for the licence field; deprecated ids are marked                                                             |
| `GET /service-roles`           | `registry.services.service.read`   | the `service.orgRole` entries, for the form                                                                                  |

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
| `service.profileContributor` | `{ id, contribute(service, ctx) }`                                                                                 | none (the Schema.org builder of sprint 3 enforces the allow-list)           |

It also contributes `org.usage` (an organisation with `svc_service_organisation` rows cannot be deleted and its type cannot change,
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
  built in sprint 3.

`service/registries.test.ts` is the worked example: a fixture module contributes one of each and loads next to this module, and a wrong
entry of each kind fails at load with the module's name in the message.

## Settings

| Setting              | Default | Effect                                                                                                                                                            |
| -------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `exposeContactPoint` | on      | On: every signed-in person sees a service's contact point. Off: only administrators (sprint 2: and the provider's members). Never public, never in a list         |
| `allowPublic`        | on      | Declared in sprint 1, effective from sprint 2: on, Reviewers and Admin may make a service public; off, every public address answers 404 and publishing is refused |

## Events

| Event                        | Payload                      | Audit                                           |
| ---------------------------- | ---------------------------- | ----------------------------------------------- |
| `registry.service.created@1` | `{ serviceId, by, actorId }` | logged, not critical (follows `channels.admin`) |

Ids and `by` only: never a name, an address or a URL (a test checks the payload). `core.audit` lists this module as an optional peer
and holds the decision in `decisions.ts`.

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
`apps/server/src/service-routes.test.ts`; the denied cases are in `defect-01.privilege-escalation.test.ts`.
