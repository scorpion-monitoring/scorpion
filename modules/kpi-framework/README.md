# kpi.framework

The indicators and KPI sets of the instance: what is measured, in which type and unit, and which set of indicators belongs to which
services. Its indicators follow the **Research Infrastructure Metrics Ontology (RIMO)** ([ADR-0040](../../docs/adr/0040-indicators-follow-rimo.md),
[m9-sprint-plan.md](../../docs/m9-sprint-plan.md)). It is the first module of the KPI phase; `kpi.ingestion` (M10) and `kpi.analytics`
(M11) build on its tables, its value types and its vocabularies.

Status: M9 sprint 2: the model, the vocabularies and the RIMO seed (sprint 1), and the indicators and KPI sets with their service
layer, internal routes, administration pages and evaluation (sprint 2). The link to services and the v1 reads are sprint 3, the RDF
reads sprint 4. The module is in the `full` profile only.

## Manifest

| Part         | Value                                                                                                                                                                                                                                                 |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id           | `kpi.framework` (package `@scorpion/kpi-framework`)                                                                                                                                                                                                   |
| table prefix | `kpif_` (set in the manifest; ADR-0004): `kpif_indicator`, `kpif_indicator_means`, `kpif_indicator_tool`, `kpif_kpi_set`, `kpif_kpi_set_indicator`, `kpif_evaluation`. `kpi.ingestion` will use `kpii_`                                               |
| dependencies | `core.authz`, `core.settings` (vocabularies, settings) and `registry.services` (sprint 3 contributes to its registries; nothing yet uses it). `registry.services` does **not** depend on this module. No foreign key points to another module's table |
| routes       | the internal routes below (sprint 2); no v1 route yet                                                                                                                                                                                                 |
| ui           | `./ui`: six pages through the registry `ui.routes` (see "Pages"), two `ui.nav` entries in the administration section                                                                                                                                  |
| events       | emits `kpi.indicator.changed@1` and `kpi.set.changed@1` (see "Events")                                                                                                                                                                                |
| registries   | declares `kpi.valueType` and contributes its five entries; contributes the vocabularies below to `vocabulary` (core.settings)                                                                                                                         |
| settings     | `iriBase` (see "Settings"), shown by the generic settings form                                                                                                                                                                                        |
| permissions  | `kpi.framework.indicator.read` and `.manage`, `kpi.framework.set.read` and `.manage` (see "Permissions"); sprint 3 adds `kpi.framework.v1.read` and the service-scoped `kpi.framework.service.kpis.edit`                                              |

## The model

Each table is in [db/schema.ts](db/schema.ts); the migration is `migrations/0000_kpi_model.sql`. **No pg enum** (a test fails on one):
the value type is a key of the registry `kpi.valueType`, everything else is a term of a vocabulary, checked by the service with
`validateTerm`. Term keys are plain columns, so a vocabulary change cannot be blocked by this module.

| Table                    | Holds                                                                                                                                                                                                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `kpif_indicator`         | `id` (UUIDv7), `slug` (unique without case, the service-slug rule, never changes), `name` (unique without case, 1 to 200), `description`, `example`, `qualitative`, `value_type`, `unit` (a `kpi.unit` term), `min_value`, `max_value` (`numeric`, `min <= max`), `thematic` (a `thematic-category` term), audit columns |
| `kpif_indicator_means`   | `(indicator_id cascade, term_key)`, primary key on the pair; the terms are of `kpi.measured-by`                                                                                                                                                                                                                          |
| `kpif_indicator_tool`    | the same for `kpi.automation-tool`                                                                                                                                                                                                                                                                                       |
| `kpif_kpi_set`           | `id`, `slug`, `name` (both unique without case), `description`, `rimo_category` (a `kpi.service-category` term, optional), audit columns                                                                                                                                                                                 |
| `kpif_kpi_set_indicator` | `(set_id cascade, indicator_id restrict)`, `necessity` (a `necessity` term, never `''`); primary key `(set_id, indicator_id)`                                                                                                                                                                                            |
| `kpif_evaluation`        | `set_id` (primary key, cascade), `indicator_id`, `aggregate` (an `aggregate` term). A composite foreign key to `kpif_kpi_set_indicator` makes the headline one of the set's indicators                                                                                                                                   |

Rules the database enforces for every writer (tested in [db/constraints.test.ts](db/constraints.test.ts)): the slug and name checks, the
order of the bounds, **a qualitative indicator has the value type `text` and no bounds** (Decision 11), a necessity is never empty
(defect 14), an indicator that a set uses cannot be deleted (the service answers 409 first), the headline is in its set. What it cannot
know, because it is registry data (is the type numeric, may it have bounds), the service checks with `boundsProblem`.

The service tables (`kpif_service_set`, `kpif_service_extra_indicator`) arrive with sprint 3.

## Value types (registry `kpi.valueType`)

An entry is `{ id, labels, numeric, range?, aggregates, parse, format, schema(config) }`, validated by the loader
(`valueTypeEntrySchema`). Nothing in the module branches on a type's id.

| Id           | Canonical value          | Accepts                                                               | `numeric`              | Aggregates                 |
| ------------ | ------------------------ | --------------------------------------------------------------------- | ---------------------- | -------------------------- |
| `integer`    | a safe integer           | a number or a decimal string (`"42"`, `"-7"`)                         | yes                    | `sum`, `avg`, `min`, `max` |
| `float`      | a finite number          | a number or a decimal string (`"1.5"`, `".5"`); no `1e3`              | yes                    | `sum`, `avg`, `min`, `max` |
| `text`       | trimmed text, 1 to 4000  | a string                                                              | no                     | none                       |
| `duration`   | seconds (a whole number) | `HH-MM-SS` (hours 0 to 9999, minutes and seconds 00 to 59) or seconds | yes (`range.min` 0)    | `sum`, `avg`, `min`, `max` |
| `percentage` | a number from 0 to 100   | a number or a decimal string                                          | yes (`range` 0 to 100) | `avg`, `min`, `max`        |

`parse(input)` answers `{ ok, value }` or `{ ok: false, problem }`; `schema(config)` is the same check as a Zod schema with the
indicator's `min` and `max`; `format(value)` writes the canonical value (a duration as `HH-MM-SS`); `aggregates` are keys of the
`aggregate` vocabulary that make sense for the type. A **qualitative** indicator must have the value type `text`; a `text` indicator may
or may not be qualitative; only a `numeric` type may have `min` and `max` (`boundsProblem(type, { min, max })`).

### How to add a value type

A module that depends on `kpi.framework` contributes an entry to `kpi.valueType` (`contributes: { 'kpi.valueType': [entry] }`). The
loader validates it against `valueTypeEntrySchema` and names the module when it is wrong; an id that two modules give stops the start.
Nothing here changes. `kpi.ingestion` and `kpi.analytics` read the entries through `ctx.deps['kpi.framework'].listValueTypes()` and use
`parse`, `format` and `aggregates`. The pure parsers and `boundsProblem` are exported from `public.ts`.

## Vocabularies

Declared and seeded at start; an administrator edits them under Settings. A term a module declared is never deleted, only deactivated
(core.settings). A `usage` check keeps a term that a row uses from being deleted; `service/terms.ts` calls `validateTerm` for every term
a save names, collects all the problems of a request and answers one 422 that names each path (`unit`, `measuredBy[0]`,
`indicators[1].necessity`, …). A deactivated term is refused for a new value and accepted for a row that keeps it.

| Vocabulary             | Seeded terms                                                                                                                             | In use when                                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `kpi.unit`             | `count`, `percent`, `second`, `byte`, `request`, `user`, `publication`, `citation` (labels en and de)                                    | an indicator has it as `unit`                    |
| `kpi.measured-by`      | none: RIMO names the class `rimo:MeasurementMeans` and no instances                                                                      | linked to an indicator in `kpif_indicator_means` |
| `kpi.automation-tool`  | none: RIMO names the class `rimo:AutomationTool` and no instances                                                                        | linked to an indicator in `kpif_indicator_tool`  |
| `kpi.service-category` | the 16 `rimo:ServiceCategory` terms of RIMO 0.2.0, keyed by their local name (`Web_application`, `SPARQL_endpoint`, …), label in English | named by a KPI set as `rimo_category`            |
| `thematic-category`    | (core.settings) `Bibliographic`, `Usage`, `Technical`, `Satisfaction`                                                                    | an indicator has it as `thematic`                |
| `necessity`            | (core.settings) `mandatory`, `recommended`, `optional`                                                                                   | a set row has it                                 |
| `aggregate`            | (core.settings) `sum`, `avg`, `min`, `max`                                                                                               | an evaluation has it                             |

The last three are declared by core.settings; this module adds their `usage` check ([backlog.md](../../docs/backlog.md), "Usage checks
for the built-in vocabularies").

### Units and the Units Ontology

[config/units.ts](config/units.ts) gives each seeded unit its Units Ontology (UO) IRI and symbol; the vocabulary holds only the key and
the labels, because a vocabulary term has no metadata yet (backlog). UO has `count unit`, `percent`, `second` and `byte`. It has no term
for a request, a user, a publication or a citation, so those four map to `count unit` (a count of a kind of thing) and have no symbol; no
UO IRI is invented. An administrator's own unit has neither an IRI nor a symbol and is exported with an IRI this instance mints.

## IRIs

`iriFor(kind, slug, base)` in [service/iri.ts](service/iri.ts) (pure, exported from `public.ts`) builds `<base>/kpi/<kind>/<slug>` for
`kind` of `indicator`, `set`, `unit`, `means` and `tool`. The slug of an indicator or set never changes, and the slug of a unit, a means
or a tool is its vocabulary key, which never changes; so an IRI never changes. A seeded RIMO category keeps its
`http://w3id.org/RIMO#<Name>` IRI and a unit with a UO IRI keeps that one. The function refuses anything that is not a plain `http(s)`
IRI (a slug with a space, `/`, `%`, `<`, `"`, non-ASCII, or over 64 characters; a base with credentials, a query, a fragment or any of
`<>"{}|^` and a backtick). **IRIs identify; they do not dereference to a page.**

## Settings

| Key       | Default | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `iriBase` | empty   | The base of every IRI: an absolute `http(s)` URL without a query, a fragment or credentials, in printable ASCII (for example `https://kpi.example.org`), or empty. Empty means the origin and base path of the request, which is right for one deployment and wrong for an IRI that has to survive a move. **Set it before you share an identifier**: changing it later changes every identifier. A bad value is a 422 that names `iriBase`. |

(The plan calls it `kpi.iriBase`: a setting belongs to its module, so it is `iriBase` of `kpi.framework`.)

## RIMO as data

| File                                           | What it is                                                                                                                                                                       |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [config/rimo/RIMO.ttl](config/rimo/RIMO.ttl)   | The ontology **as published**, unchanged. Version 0.2.0, taken from commit `5ead6c6fce43708be2f9cbb0258139b1f8b390df` of <https://github.com/JKoblitz/BH25-metrics> (2025-11-19) |
| [config/rimo-seed.json](config/rimo-seed.json) | Generated: the ontology's IRI, title, version, dates and licence, and the 16 service categories with IRI, label and comment. Never edit by hand                                  |
| [scripts/rimo-seed.ts](scripts/rimo-seed.ts)   | The extractor: `pnpm --filter @scorpion/kpi-framework rimo:seed` writes the seed, `-- --check` compares                                                                          |

**Licence and attribution.** RIMO is © the BioHackathon Europe 2025 METRICS team (creator Julia Koblitz) and is published under
[CC BY 4.0](http://creativecommons.org/licenses/by/4.0/). `RIMO.ttl` is included unchanged; `rimo-seed.json` and the `kpi.service-category`
vocabulary are derived from it (the names, labels and comments of the service categories). The seeded categories are the
"service categories" of bio.tools' tool types as RIMO lists them.

**The extractor** reads the one regular shape of that file and **fails loudly, with the line, on any other**: `@prefix` lines, `#`
comments, `subject predicate object` statements with `;` and `,` lists, IRIs, prefixed names, the keyword `a`, and strings with a
language tag or a datatype (short or triple-quoted). It does **not** handle blank nodes, collections, numbers, booleans, `@base`,
SPARQL-style `PREFIX`, single-quoted strings or escapes in names. It needs exactly one English `rdfs:label` and `rdfs:comment` per
category, a category in the `http://w3id.org/RIMO#` namespace whose local name can be a term key, and the ontology's title, licence,
version (`x.y.z`), `dct:issued` and `dct:modified`. A test per construct and a **drift test** (the committed seed is what the committed
`RIMO.ttl` produces) guard it. Nothing fetches RIMO at run time or in CI.

**Adopting a newer RIMO** is a change you can read: replace `RIMO.ttl`, change the commit and version here and in ADR-0040, run
`rimo:seed`, read the seed's diff. A new category is seeded at the next start. A category that disappeared or changed its IRI is a
migration for sets that name it and needs an ADR.

## Events

| Event                     | Payload                                                                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `kpi.indicator.changed@1` | `{ indicatorId, change: created \| updated \| deleted, fields: string[], actorId }`                                                            |
| `kpi.set.changed@1`       | `{ setId, change: created \| updated \| deleted, fields: string[], actorId }`; `fields` names `indicators` and `evaluation` when those changed |

Ids and field names only, never a name, a description or a value (a test refuses a payload that adds one). `core.audit` logs both, not
critical (see its README). Every write emits its event in the same transaction as the rows (the outbox), so a failed event leaves no row:

| Write                                   | Event                   | `change` and `fields`                                                                                                                                                         |
| --------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `indicators.create`, `update`, `delete` | `kpi.indicator.changed` | `created` / `deleted` with no fields; `updated` with the names of the fields that changed (`measuredBy`, `canBeAutomatedBy` included). Nothing changed: no write and no event |
| `sets.create`, `update`, `delete`       | `kpi.set.changed`       | the same for `name`, `description`, `rimoCategory`                                                                                                                            |
| `sets.setIndicators`                    | `kpi.set.changed`       | `updated`, `fields: ['indicators']`, plus `'evaluation'` when the headline was removed with its row                                                                           |
| `evaluation.set`                        | `kpi.set.changed`       | `updated`, `fields: ['evaluation']`                                                                                                                                           |

## Permissions

| Permission                       | Grants                                                                     | Default role  |
| -------------------------------- | -------------------------------------------------------------------------- | ------------- |
| `kpi.framework.indicator.read`   | read and list indicators, list the value types                             | `user`, Admin |
| `kpi.framework.indicator.manage` | create, change and delete indicators                                       | Admin         |
| `kpi.framework.set.read`         | read and list KPI sets, their rows and their evaluation                    | `user`, Admin |
| `kpi.framework.set.manage`       | create, change and delete KPI sets, replace their rows, set the evaluation | Admin         |

Each route names its permission and each service method checks it again with `ctx.authz.require`. Admin holds every declared permission
without a grant (core.authz); the `user` grants are the module's `authz.defaultRole` contribution.

## Routes (internal API)

| Route                                       | Permission                  | Notes                                                                                                                                                                                                                                     |
| ------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /kpi/indicators`                       | `indicator.read`            | `q` (name, slug, description; `%` and `_` are literal), `thematic`, `unit`, `qualitative`, `sort` (`name`, `thematic`, `unit`, `valueType`; ties by name, then id), `page` from 0, `pageSize` 1 to 100                                    |
| `POST /kpi/indicators`                      | `indicator.manage`, audited | 201; slug made from the name when not given; 409 names `name` or `slug`; 422 names every bad path                                                                                                                                         |
| `GET`, `PUT`, `DELETE /kpi/indicators/{id}` | read / manage, audited      | `PUT` replaces the editable fields (a field left out is cleared; the slug never changes); `DELETE` is 409 `kpi-in-use` while a set row or an evaluation uses it                                                                           |
| `GET /kpi/value-types`                      | `indicator.read`            | the registry entries (id, labels, `numeric`, `range`, `aggregates`), by id                                                                                                                                                                |
| `GET /kpi/sets`                             | `set.read`                  | `q`, `rimoCategory`, `sort` (`name`, `rimoCategory`); each row has `indicatorCount` and `necessityCounts` for the badges                                                                                                                  |
| `POST /kpi/sets`                            | `set.manage`, audited       | 201; the set has no rows yet                                                                                                                                                                                                              |
| `GET`, `PUT`, `DELETE /kpi/sets/{id}`       | read / manage, audited      | the detail has the rows and the evaluation; `DELETE` removes rows and evaluation (a service that uses the set blocks it from sprint 3)                                                                                                    |
| `PUT /kpi/sets/{id}/indicators`             | `set.manage`, audited       | replaces the rows in one transaction (add, change necessity, remove); an empty necessity, an unknown term or indicator and a repeat are 422 naming `indicators[i].…`; removing the headline clears the evaluation in the same transaction |
| `GET`, `PUT /kpi/sets/{id}/evaluation`      | read / manage, audited      | `GET` answers `{ evaluation: null }` without a headline; `PUT` needs a headline that is a row of the set and an aggregate that the value type allows and the vocabulary has active                                                        |

Lists use the legacy envelope (`{ metadata, result }`, 0-based pages). An unknown id is 404, a malformed one 422, an unknown term 422 with
the path, a duplicate name or slug 409, never a 500. Every string and list is bounded (names 200, descriptions 4000, examples 1000, 50
terms per link list, 500 rows per set). Responses carry `iri` (`<base>/kpi/<kind>/<slug>`, base from the setting `iriBase`).
Internal routes are not part of the public v1 document.

### Rules the service enforces

- **Terms** (unit, thematic category, means, tools, RIMO category, necessity, aggregate) are checked with `checkTerms` before the
  transaction opens: one 422 names every bad path. A row keeps a term it already has when that term was deactivated since.
- **Value type and bounds** come from the registry: the type must exist, `boundsProblem` decides whether bounds fit, and a qualitative
  indicator has the value type `text` and no bounds.
- **Evaluation**: the headline is a row of the set; the aggregate is in the `aggregates` of the headline's value type and an active term
  of `aggregate`. A change of an indicator's value type that would strand a headline's aggregate is a 409.
- **Slugs** are made from the name when not given (accents folded, runs of other characters become `-`, at most 64 characters; a taken
  slug gets `-2`, `-3`, …) and never change on a rename. Names and slugs are unique without regard to case.
- **Deletes** are by id. An indicator in a set is a 409 that names the module and the count before the database's `restrict` is reached.

## Pages

Six pages through the registry `ui.routes` (never a SvelteKit file route), all for an administrator (`indicator.manage` or `set.manage`)
and linked from the administration section of the navigation:

| Path                                         | Shows                                                                                                                                                                                        |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/kpi/indicators`                            | the list with the search and the filters (thematic category, unit, kind) in the address                                                                                                      |
| `/kpi/indicators/new`, `/kpi/indicators/:id` | the form with every RIMO field (name, description, example, qualitative, value type, unit, bounds, thematic category, means, tools), the identifier and IRI, where it is used and the delete |
| `/kpi/sets`                                  | the list with the RIMO category filter and a badge per necessity                                                                                                                             |
| `/kpi/sets/new`, `/kpi/sets/:id`             | the details, the rows (a paginated picker over `GET /kpi/indicators`, a necessity per row, saved together), the evaluation (headline and aggregate) and the delete                           |

Labels of units, categories, necessities, aggregates, means, tools and value types come from the vocabularies and the registry; the texts
are in English and German (`ui/messages.ts`). Pure helpers (`ui/query.ts`, `form.ts`, `rows.ts`, `terms.ts`, `failure.ts`, `errors.ts`)
have table-driven tests.

## Migration from the old application (for M13)

| Old                          | New                                                                   |
| ---------------------------- | --------------------------------------------------------------------- |
| indicator type `number`      | `integer`                                                             |
| indicator type `float`       | `float`                                                               |
| indicator type `text`        | `text`                                                                |
| indicator thematic category  | `thematic` (the same vocabulary `thematic-category`)                  |
| a "category" with indicators | a KPI set; `rimo_category` stays empty until an administrator maps it |
| necessity per indicator      | the `necessity` term of the set row                                   |

## Tests

`pnpm test --filter @scorpion/kpi-framework`. Table-driven unit tests for the value types, the IRIs, the slugs and the extractor (with the
seed drift test) and for the pure helpers of the pages; integration tests over real Postgres for the loader and the schema
([module.test.ts](module.test.ts)), the constraints ([db/constraints.test.ts](db/constraints.test.ts)), the usage checks and save-time
term checks ([service/vocabularies.test.ts](service/vocabularies.test.ts)) and every service method
([service/indicators.test.ts](service/indicators.test.ts), [sets.test.ts](service/sets.test.ts),
[evaluation.test.ts](service/evaluation.test.ts)), each with a denied-permission case and a rollback case for the multi-row writes.
The routes are tested through the whole pipeline in `apps/server/src/kpi-routes.test.ts` and the regression test of defect 14 in
`apps/server/src/defect-14.kpi-sets.test.ts`; the pages in `apps/web/src/kpi-pages.test.ts` and the journey and axe in
`apps/web/e2e/kpi-framework.spec.ts`. Factories: `makeIndicator` and `makeKpiSet` in `packages/testing`.
