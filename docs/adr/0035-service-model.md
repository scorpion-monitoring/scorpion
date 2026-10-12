# ADR-0035: the service model, the registries and the typed configuration

- Status: Accepted
- Date: 2026-10-12

## Context

M7 adds `registry.services` ([m7-sprint-plan.md](../m7-sprint-plan.md)). Three things in it are decisions that other modules copy or
extend: the shape of the tables and of a slug that can change, the way the wizard and the metadata schema are configured (the
successors of the legacy `steps.json` and `service_schema.json`), and the registries through which `kpi.framework` (M9) and later modules
add field types, steps, organisation roles, facets and profile properties without a change to this module. The architecture
([architecture.md](../architecture.md) §4.6, §4.8) fixes the principle (registries, adapters); this ADR fixes the details.
The access rules (the policy `service.member`, the three edit groups, the publication flag) are ADR-0036, written with sprint 2.

## Decision

### Tables (prefix `svc_`, `tablePrefix: 'svc_'`)

| Table                     | Holds                                                                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `svc_service`             | `id` (UUIDv7), `slug` (unique without case), `name`, `license` (SPDX id), `stage` (a term of the `stage` vocabulary), `description`, `url`, `same_as`, the contact pair, the icon, `public`, audit columns |
| `svc_service_organisation`| `service_id` (cascade), `organisation_id`, `role` (a key of `service.orgRole`); unique on the triple                                                                                         |
| `svc_field_value`         | `service_id` (cascade), `field_key`, `value` (`jsonb`); unique on the pair: the values of configured fields that are not columns                                                              |
| `svc_slug_history`        | every slug a service has had, **the current one included**; unique without case                                                                                                              |
| `svc_license_cache`       | one row: the fetched SPDX list and its time                                                                                                                                                  |

No pg enum anywhere: the stage is a vocabulary term, the role a registry key, the field key a configured string; each is checked in the
service. **No foreign key** to `org_organisation`, `identity_user` or the blob table: organisation ids, user ids and the icon's blob
id are plain columns that the service checks (as in M6), so a purge or the blob cleanup cannot be blocked by this module. Foreign keys
point only to the module's own tables.

### The slug and its history

A slug matches `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`, is **not shaped like a UUID** and is not one of the reserved page words (`new`,
`facets`, `schema`, `by-slug`, `public`, `edit`), so `/services/{id}` and `/services/{slug}` cannot clash. A service is addressed by id
(stable, the `@id` of its profile) or by slug. Uniqueness across the current and all old slugs is one unique index on
`svc_slug_history(lower(slug))`, because the table holds the current slug too: a create inserts the first row, a rename (sprint 2)
inserts the next; an old slug is therefore never given to another service, and two writers racing for one slug are decided by the
database, not by a read-then-write. `svc_service.slug` keeps its own case-insensitive unique index. A lookup by slug resolves through
the history; when the matched row is not the current slug the answer carries `redirectedFrom`.

### Typed configuration, validated at start

`config/fields.ts` and `config/steps.ts` are TypeScript, typed, and replace the two legacy JSON files. A **field** has a `key`, a JSON
pointer `path` into the one nested form object (`/name`, `/contact/type`), a `type` (an entry of `service.fieldType`), a label key, a
help key, `required`, a type-specific `config`, a `storage` and an optional `schemaOrg` property (one of `termsOfService`,
`areaServed`, `audience`, `slogan`). `storage` is `column` (a column of `svc_service`), `organisations` (a role of
`service.orgRole`), `value` (a key of `svc_field_value`) or `icon` (set by the icon routes after the service exists). A **step** has an
`id`, an `order`, a title key, `intro` message keys (the paragraphs the legacy file called `texts`) and the keys of its fields or a
`component`. The validator runs when the module starts and refuses to start with a message that names the file and the field for an
unknown field type, a duplicate key or path, a column that does not exist, a step that names an unknown field, a `schemaOrg` outside
the allow-list, a bad type config and a step order clash. Steps and fields contributed by other modules are validated by the same
function. Changing the configuration means a rebuild, as for plugins (CLAUDE.md).

`svelte-keyed` and the ISA Wizard questionnaire were **evaluated and not adopted**. Svelte 5 deep state with JSON-pointer-addressed
fields already binds a value to a path; the ISA format is the legacy `steps.json` shape that the typed config keeps (`title`, `intro`
paragraphs, `fields`, `component`); a new dependency has no justification. Taken over: the `intro` paragraphs and path-addressed
fields. Not taken over: a silent skip of an unknown field type, a remount of the step on every move, an untyped config. A **base path
per step** (the same field list bound below a nested path, so M9 or M15 can reuse a step) is a later option, not built.

### The five registries

All are declared by `registry.services`; the loader validates every entry with Zod and names the contributing module in the message
(`composition.ts`); a module may contribute only if it declares `registry.services` as a dependency.

| Registry                        | Entry                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `service.orgRole`               | `{ id, labels, orgTypes, min, max, order }`; seeded `provider` (1..1) and `consortium` (0..20)           |
| `service.fieldType`             | `{ id, labels, widget, configSchema, schema(config), jsonSchema(config), check?, toValue?, schemaOrg? }`; seeded `text`, `select`, `multi-select`, `license`, `organisation`, `image` |
| `service.wizardStep`            | `{ id, order, title, intro, fields, component?, applies? }`; the module's own steps are its config     |
| `service.facet`                 | `{ id, labels, order, emptyLabel?, where(selected), values(scope, db) }`; seeded `consortium`, `stage`, `license`, `provider` |
| `service.profileContributor`    | `{ id, contribute(service, ctx) }`; the allow-list of properties is enforced when the profile is built (sprint 3) |

A contributing module must provide, for a field type: a Zod schema for the value and for its config, the JSON Schema of both, the
widget name the UI maps, and, if the value refers to other data, a `check` that returns a problem text. A role's `orgTypes` must be
registered `org.type` ids (checked at start). The module also contributes `org.usage` (an organisation with `svc_service_organisation`
rows cannot be deleted or change type) and the `usage` of the `stage` vocabulary (a term a service uses cannot be deleted).

### The catalogue is a query function

The legacy `service_view` joined every service to every consortium (defect 2). The catalogue (sprint 4) is a tested TypeScript query
function over the tables, one query per concern, a service once whatever its number of consortia. No SQL view.

### Schema.org

A service presents a Schema.org `Service` ([m7-sprint-plan.md](../m7-sprint-plan.md) §3): provider → `provider`, consortia → `brand`,
the category (M9, through `service.profileContributor`) → `serviceType` and `category`. Stage and contact point are stored and not
mapped. The builder arrives in sprint 3.

### Licences

The SPDX list comes through `packages/integrations` (`createSpdx`): 5 s timeout, retry with backoff, a cache port (this module supplies
it over `svc_license_cache`, 24 h) and a bundled fallback copy with its release. An unknown id is 422; a deprecated id is accepted and
marked.

## Consequences

- A new field type, step, role, facet or profile property is a contribution; this module has no `if` on any of them.
- A wrong contribution or configuration stops the server at start with a message that names the module or the file and the field.
- The slug history is a registry of every slug, which keeps the uniqueness rule in one index; it costs one row per rename.
- The catalogue's performance rests on indexes on the filter columns; a materialised read model is a backlog item if a profile with
  thousands of services shows a problem.
