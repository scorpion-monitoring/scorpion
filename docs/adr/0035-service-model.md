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

| Table                      | Holds                                                                                                                                                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `svc_service`              | `id` (UUIDv7), `slug` (unique without case), `name`, `license` (SPDX id), `stage` (a term of the `stage` vocabulary), `description`, `url`, `same_as`, the contact pair, the icon, `public`, audit columns |
| `svc_service_organisation` | `service_id` (cascade), `organisation_id`, `role` (a key of `service.orgRole`); unique on the triple                                                                                                       |
| `svc_field_value`          | `service_id` (cascade), `field_key`, `value` (`jsonb`); unique on the pair: the values of configured fields that are not columns                                                                           |
| `svc_slug_history`         | every slug a service has had, **the current one included**; unique without case                                                                                                                            |
| `svc_license_cache`        | one row: the fetched SPDX list and its time                                                                                                                                                                |

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

| Registry                     | Entry                                                                                                                                                                                                             |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `service.orgRole`            | `{ id, labels, orgTypes, min, max, order }`; seeded `provider` (1..1) and `consortium` (0..20)                                                                                                                    |
| `service.fieldType`          | `{ id, labels, widget, storages, configSchema, schema(config), jsonSchema(config), check?, toValue?, schemaOrg? }`; seeded `text`, `select`, `multi-select`, `license`, `organisation`, `image`                   |
| `service.wizardStep`         | `{ id, order, title, intro, fields, component?, applies? }`; the module's own steps are its config                                                                                                                |
| `service.facet`              | `{ id, labels, order, emptyLabel?, where(selection, serviceId), values(matching, db), unknownOf?, labelsOf? }`; seeded `consortium`, `stage`, `license`, `provider` (shape changed in sprint 4, see the addendum) |
| `service.profileContributor` | `{ id, contribute(service, ctx) }`; the allow-list of properties is enforced when the profile is built (sprint 3)                                                                                                 |

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

## Addendum (M7 sprint 4): the catalogue

**`list` is the catalogue.** `ServicesService.list` is replaced by the catalogue query function (`service/catalogue.ts`); there is one code
path for one list. It takes the search, the chosen facet values by facet id, the sort (`name`, `slug`, `stage`, `provider`) and the page, and
returns rows `{ id, slug, name, stage, license, iconUrl?, public, provider, consortia[] }` and the total. `ServiceSummary` (with a flat
`organisations` list) stays as the base of the record. `GET /services` is an internal route, so its row changed shape with it (the flat
`organisations` list became `provider` and `consortia`); nothing outside this repository consumes it yet, and the public API v1 (M8) reads
the trusted reads, not this route.

**One query per concern.** The rows (one `select` over `svc_service`, with `limit` and `offset`), the total (one `count`), the organisation
links of the page (two queries for any number of rows, through the organisation module's public read for the names) and one count per
facet. No query per row. A service is a row of `svc_service` and nothing is joined to it: a facet's condition is an `exists` on the links,
so a service with no consortium is in the result, a service with two is in it once, and it is never in a consortium it does not belong to
(defect 2, `apps/server/src/defect-02.service-consortium.test.ts`).

**Facet semantics (Decision 13).** Each facet counts over the set that the search and _every other_ facet leave: OR within a facet, AND
across facets, so a person sees what one more choice would give. A value that no service has in that set is shown with count 0 only when it
is chosen. The services that have no value are one more value, `:none` (`FACET_EMPTY`), labelled by the entry's `emptyLabel` (`Unknown`
for a licence, `Uncategorized` for the category of M9); a facet without an `emptyLabel` has no such value and refuses `:none` with a 422.
A value that names nothing is a 422 and never an empty list that hides a typo: an organisation that does not exist, a stage term nobody
declared, a licence SPDX does not list, a filter that is no registered facet.

**The facet entry shape was too narrow, and is changed.** Sprint 1 gave an entry `where(selected)` and `values(scope, db)` with `scope` a
condition on `svc_service`. A module that contributes a facet (M9's category) cannot name `svc_service` and must not read
`svc_field_value` itself, so that shape forced it to break the table rule or to be a seed of this module. The entry now is:

- `where(selection, serviceId)`: the condition for the chosen values, with `selection = { keys, empty }` (the choice of "none" is separate
  from the keys) and `serviceId` the service's id column to correlate with; no table is named by the contributor;
- `values(matching, db)`: the values over the services whose id is in `matching`, a subquery of ids (the search and the other facets'
  conditions), counted once per service, `key: null` for the services with none;
- `unknownOf(keys, env)` (optional): the keys that name nothing, for the 422;
- `labelsOf(keys, env)` (optional): a label per key (an organisation's name, a vocabulary term's label in the caller's locale); a key
  without one is shown as it is.

`fieldValueFacet(id, fieldKey, entry)` (exported by `public.ts`) builds an entry for a value kept in `svc_field_value`, a text or a list of
texts, so the category of M9 is one call and no SQL. A fixture module proves the extension with such an entry and with an entry that
brings its own SQL (`service/catalogue.test.ts`).

**The sort by provider** sorts by the provider's _name_, which lives in the organisation module. The catalogue asks it for the names of the
providers that exist (one call), orders them, and sorts the services by the position of their provider in that list; no foreign table is
named and no query runs per row. Ties are broken by the id, in either direction, so the order is stable across pages.

**Performance.** Indexes exist on `stage`, `license`, `lower(name)` and on the organisation links by organisation and role. The facet
conditions use `exists` on `(service_id, organisation_id, role)`, which the unique index covers. `catalogue.test.ts` pages and counts 300
generated services with two active filters and four facets in about 45 ms on a local Testcontainers database (the test allows 2 s); a materialised read model stays a
backlog item for a profile of thousands.

**The UI half.** `registry.services` has a `ui` entry (`./ui`) and registers `ui.routes` and `ui.nav` without the shell present (it is an
optional peer; the module starts without it, as the shell-less test of the harness shows). `/services/new` and `/services/:slug` are
registered on the server and listed in `NOT_OFFERED`; the catalogue links to them only when they are offered, and `ui/ui.test.ts` and
`apps/server/src/ui-routes.test.ts` keep the two halves in agreement.

## Addendum (M7 sprint 5): the schema route and the one-generator rule

- **`GET /services/schema` tells the create wizard what to draw.** It is a pure function of the resolved configuration and the registries
  (`service/create-schema.ts`) plus the options the service resolves (the active terms of a vocabulary a choice field names), so the page holds no
  field, step, limit or type. It names `…service.create`, the permission of the wizard page, and holds nothing of any person or service. The
  alternative, `…service.read`, would have given it to Reviewers, who cannot use it.
- **One generator.** The schema of a field is the field type's `jsonSchema(config)`, and the server validates with the same entry's
  `schema(config)`. A third representation (generating the JSON Schema from the Zod one) was not built: Zod's own conversion cannot express the
  transforms and parsers of the organisation's field rules. The two functions of an entry are held together by a test that feeds both the same
  table of values (`create-schema.test.ts`), which already found one drift (the id of an organisation); the browser's schema is never stricter than
  the server's, and what only the server can judge (it needs data) is marked in the table. The browser checks with a small checker of the keywords
  the generated schemas use (`@scorpion/ui-kit/json-schema`): no schema library was added, and a keyword the checker does not know is reported.
- **`applies` stays in the browser.** It is a function and cannot travel in the schema. The page asks it through `ui/wizard-extensions.ts`; the server
  ignores it, so a step that `applies` hides must have no required field. How the `ui` entry of a contributing module reaches the extension file (its
  widget and its condition) is left to M9: the shell forwards routes, messages and widgets of a `ui` entry, and a fourth export is a change to the
  shell that M9 can justify with a real contributor.
- **The dev console** is shown only when the schema says `devConsole: true`, which the server computes from `NODE_ENV !== 'production'` at start
  (`devConsoleAllowed`); the page does not draw it otherwise.
- **A base path per step** (the same field list bound below a nested path, so a step can be reused) stays recorded as a later option (Decision 21 of the
  M7 plan); the pointers of the fields are absolute today.
- **The choice fields** carry their options: a field type's optional `choices(config, env)` returns them, so the page has no `if (type === 'select')`
  and a contributed choice type needs no change here.
