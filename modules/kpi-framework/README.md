# kpi.framework

The indicators and KPI sets of the instance: what is measured, in which type and unit, and which set of indicators belongs to which
services. Its indicators follow the **Research Infrastructure Metrics Ontology (RIMO)** ([ADR-0040](../../docs/adr/0040-indicators-follow-rimo.md),
[m9-sprint-plan.md](../../docs/m9-sprint-plan.md)). It is the first module of the KPI phase; `kpi.ingestion` (M10) and `kpi.analytics`
(M11) build on its tables, its value types and its vocabularies.

Status: M9 sprint 4: the model, the vocabularies and the RIMO seed (sprint 1), the indicators and KPI sets with their service layer,
internal routes, administration pages and evaluation (sprint 2), the link of a service to its KPI set and extra indicators, the
`kpi-set` wizard step, the section of the service page, the catalogue facet and the v1 reads `categories` and `indicators` (sprint 3),
and the RDF reads of the indicators as Turtle and JSON-LD, token-bearing and public (sprint 4). The module is in the `full` profile only.

## Manifest

| Part         | Value                                                                                                                                                                                                                                                                                                                       |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id           | `kpi.framework` (package `@scorpion/kpi-framework`)                                                                                                                                                                                                                                                                         |
| table prefix | `kpif_` (set in the manifest; ADR-0004): `kpif_indicator`, `kpif_indicator_means`, `kpif_indicator_tool`, `kpif_kpi_set`, `kpif_kpi_set_indicator`, `kpif_evaluation`, `kpif_service_set`, `kpif_service_extra_indicator`, `kpif_service_kpi_history`. `kpi.ingestion` uses `kpii_`                                         |
| dependencies | `core.authz`, `core.settings` (vocabularies, settings) and `registry.services` (it contributes to its registries and asks it whether a service exists and who may change it). `registry.services` does **not** depend on this module. No foreign key points to another module's table, a service included                   |
| routes       | the internal routes below, the two public reads `GET /public/kpi/rimo.ttl` and `.jsonld`, and four v1 routes (`GET /api/v1/categories`, `/indicators`, `/kpi/rimo.ttl` and `/kpi/rimo.jsonld`, see "Routes")                                                                                                                |
| ui           | `./ui`: six pages through the registry `ui.routes` (see "Pages"), two `ui.nav` entries in the administration section, and the fourth export `wizardExtensions` (the widget of the `kpi-set` field and the section of the service page)                                                                                      |
| events       | emits `kpi.indicator.changed@1`, `kpi.set.changed@1` and `kpi.serviceSet.changed@1` (see "Events")                                                                                                                                                                                                                          |
| registries   | declares `kpi.valueType` and contributes its five entries; declares `kpi.indicatorUsage` (see "The history and the in-use hook"); contributes the vocabularies below to `vocabulary` (core.settings), and to `registry.services` the field type, the wizard step and the facet below, and to `core.authz` a resource policy |
| settings     | `iriBase` (see "Settings"), shown by the generic settings form                                                                                                                                                                                                                                                              |
| permissions  | `kpi.framework.indicator.read` and `.manage`, `kpi.framework.set.read` and `.manage`, the service-scoped `kpi.framework.service.kpis.edit` and `kpi.framework.v1.read` (see "Permissions")                                                                                                                                  |

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

| `kpif_service_set` | `service_id` (primary key, a **plain column**: no foreign key to `svc_service`), `set_id` (restrict), `updated_at`, `updated_by`. One KPI set per service |
| `kpif_service_extra_indicator` | `(service_id, indicator_id restrict)`, primary key on the pair: an indicator a service chose beyond its set |
| `kpif_service_kpi_history` | `(service_id, valid_from)` primary key, `set_id`, `extras` (`uuid[]`, at most 200), `valid_to` (null while current), `changed_by`: which set and extras a service had, and when (see "The history and the in-use hook") |

The migration of the service tables is `migrations/0001_service_link.sql`. The service layer checks that a service exists through
`registry.services/public` (`existsAsSystem`); a service is never deleted today, so nothing is left behind (the delete will need a
`service.usage` check, see the backlog). A KPI set that a service uses is not deleted (409, `restrict` as the last guard), and neither is
an indicator that a service chose as an extra.

### The history and the in-use hook

**History** (M10 sprint 1, [ADR-0041](../../docs/adr/0041-measurement-model.md) Decision 3). `kpif_service_kpi_history` records which KPI set and
which extras a service had, so that `kpi.ingestion`, `kpi.analytics` and `kpi.impact` can ask which KPIs a service had in a month; the
effective set _now_ cannot answer that once a set or the extras changed. A row is a state from `valid_from` (inclusive) to `valid_to`
(exclusive; null while it is the current one). The one writer of a service's KPIs (`KpisWriter.write`, used by `serviceKpis.set` and by the wizard's
`store`) appends a row **in the same transaction** and closes the row before it, whenever the set or the extras changed; a change that
changes nothing writes nothing, and a rolled-back change leaves no row (tests for both transactions). The new row begins at the database
clock, at least a microsecond after the one it closes, under the per-service advisory lock of the writer. The table is **append-only**
(migration `0002`, a trigger like `core.audit`'s): a delete is refused, and so is every update except closing the open row, once. A later
deletion of services needs a migration that drops the trigger, with an ADR.

`kpisInPeriod(serviceId, period)` (on the service and so on `public.ts`; a trusted read, no permission check, the caller checks its own)
answers with the state **in force at the end of the month** `period` names (`YYYY-MM` or `YYYY-MM-DD`, any day): `{ setId, extras, validFrom,
rows }`, or `null` when the history holds none for that month (before the first row: history starts at the migration for what changed
before it; the backfill takes `valid_from` from the `updated_at` of the service's set row, and a service with extras only starts at the migration).
Two changes in one month leave the later one. `rows` is the effective list of that state through the same function as today's
(`effectiveOf`), so there is one rule. **Limits:** the rows of a _set_ are not versioned (a set edited later shows its new rows in every month
that used it; backlog), and an extra whose indicator was deleted since is named in the history and dropped from `rows`. An impossible period
(`2026-02-30`, `2026-13`) is 422 naming `period`.

**`thematic` on both trusted reads** (M11 sprint 3, additive): `effectiveIndicatorsAsSystem` rows and `indicatorsByIdAsSystem` rows carry the indicator's `thematic` (a term of the vocabulary `thematic-category`), so that `kpi.analytics` can filter a service's KPIs by category without reading `kpif_indicator`. Tested in `service/trusted.test.ts`.

**Two trusted reads for `kpi.ingestion`** (M10 sprint 2, additive; on the service and so on `public.ts`; no permission check, the caller checks its own, descriptive
fields only). `effectiveIndicatorsAsSystem(serviceId)` returns the effective KPI set of a service with the value type, unit, necessity, source and
**bounds** of each indicator (`[]` for a service without KPIs or one that does not exist); it reads the set through `effectiveSet`, so it is the list
`serviceKpis.get` answers with. `indicatorsByIdAsSystem(ids)` returns the name, IRI, value type and unit of indicators by id (at most 5 000; an id that is
no indicator is left out), because the reads of measurements show a value of an indicator the service has since dropped. A module that writes values calls
them **after** its own scoped check, so a token needs the scopes of that module and none of this one's reads (ADR-0041, "Amended in sprint 2"). Tests:
`service/trusted.test.ts`.

**The in-use hook.** `kpi.framework` declares the registry `kpi.indicatorUsage`; an entry is `{ module, what, count(indicatorId) }` (a module id, a
plural noun, and a function that counts that module's rows about the indicator). `indicators.delete` asks every entry after its own checks, and an
indicator that something uses is **409 naming each module and the count** (`kpi.ingestion (12 measurements)`), the sets first and then each
contributor. The `restrict` key of the contributor's table stays as the last guard, and a refusal by any key is 409, not 500. `kpi.ingestion`
contributes the count of its measurements. A module that stores rows about an indicator contributes one entry; nothing here names a module.

### The effective KPI set of a service

One rule, written once in [service/merge.ts](service/merge.ts) (pure: the browser draws the same list the server answers with) and one
query functions over it in [service/effective.ts](service/effective.ts), `effectiveSet` (the service's links, then `effectiveOf`) and `effectiveOf` (a given set and extras, also for a past state): the rows of the service's KPI set with their
necessity, plus the extras that the set does **not** contain, each with the necessity `optional`. An indicator in the set cannot be an
extra (it is dropped on write and ignored on read), the set's rows are never removed or changed by an extra, an indicator appears once,
and the order is stable: set rows first, then extras, each by name without case, then name, then id, whatever the order of the input.
Property tests over generated data prove it ([service/merge.test.ts](service/merge.test.ts)).

## Demo data (`scorpion seed --demo`)

`demoSeed` creates five example indicators (`demo-active-users`, `demo-requests`, `demo-publications`, `demo-uptime`, `demo-satisfaction`), the KPI set `demo-core-kpis`
with their necessities, and sets that KPI set on each demo service, through `indicators.create`, `sets.create`, `sets.setIndicators` and `serviceKpis.set` as the demo
administrator. It finds what exists by slug, so a second run adds nothing ([ADR-0046](../../docs/adr/0046-demo-seed.md)).

## Value types (registry `kpi.valueType`)

An entry is `{ id, labels, numeric, range?, input?, aggregates, parse, format, schema(config) }`, validated by the loader
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

**How a form asks for a value (`input`, M10 sprint 4).** An optional descriptor `{ kind: 'number' | 'text', step?: number | 'any', pattern?: string, hint?: string }`
that the Data Submission page draws its input from (`GET /kpi/value-types` answers it), so no page names a type: `integer` is a number input with `step` 1, `float` and
`percentage` have `step` `any`, `duration` is a text input with the pattern of `HH-MM-SS` and the hint `HH-MM-SS`, `text` is plain text. A type without a descriptor is drawn as a number
input when it is `numeric` and as text otherwise. It never replaces `parse`: the server judges every value, and a test checks that the duration's pattern accepts and refuses what
`parseDuration` does.

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

| Event                      | Payload                                                                                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `kpi.indicator.changed@1`  | `{ indicatorId, change: created \| updated \| deleted, fields: string[], actorId }`                                                            |
| `kpi.set.changed@1`        | `{ setId, change: created \| updated \| deleted, fields: string[], actorId }`; `fields` names `indicators` and `evaluation` when those changed |
| `kpi.serviceSet.changed@1` | `{ serviceId, setId \| null, fields: string[], actorId }`; `fields` names `set` and `extras` when those changed (never the indicators)         |

Ids and field names only, never a name, a description or a value (a test refuses a payload that adds one). `core.audit` logs all three, not
critical (see its README). Every write emits its event in the same transaction as the rows (the outbox), so a failed event leaves no row:

| Write                                      | Event                    | `change` and `fields`                                                                                                                                                         |
| ------------------------------------------ | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `indicators.create`, `update`, `delete`    | `kpi.indicator.changed`  | `created` / `deleted` with no fields; `updated` with the names of the fields that changed (`measuredBy`, `canBeAutomatedBy` included). Nothing changed: no write and no event |
| `sets.create`, `update`, `delete`          | `kpi.set.changed`        | the same for `name`, `description`, `rimoCategory`                                                                                                                            |
| `sets.setIndicators`                       | `kpi.set.changed`        | `updated`, `fields: ['indicators']`, plus `'evaluation'` when the headline was removed with its row                                                                           |
| `evaluation.set`                           | `kpi.set.changed`        | `updated`, `fields: ['evaluation']`                                                                                                                                           |
| `serviceKpis.set`, and the wizard's create | `kpi.serviceSet.changed` | `fields` is `set`, `extras` or both; nothing changed: no write and no event. The wizard's create writes it in the transaction of the service (see "The wizard step")          |

## Permissions

| Permission                        | Grants                                                                                     | Default role                                                                                                                                                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kpi.framework.indicator.read`    | read and list indicators, list the value types                                             | `user`, Admin                                                                                                                                                                                                                                        |
| `kpi.framework.indicator.manage`  | create, change and delete indicators                                                       | Admin                                                                                                                                                                                                                                                |
| `kpi.framework.set.read`          | read and list KPI sets, their rows and their evaluation                                    | `user`, Admin                                                                                                                                                                                                                                        |
| `kpi.framework.set.manage`        | create, change and delete KPI sets, replace their rows, set the evaluation                 | Admin                                                                                                                                                                                                                                                |
| `kpi.framework.service.kpis.edit` | change the KPI set and the extra indicators of one service; **scope `service`** (ADR-0036) | Admin; the approved **managers** of the service's provider through the policy `service.member` (a plain member reads the KPIs and cannot change them; choosing a set while creating the service is part of the create and stays open to its creator) |
| `kpi.framework.v1.read`           | `GET /api/v1/categories` and `/api/v1/indicators` with a token that holds this scope       | `user`, Admin                                                                                                                                                                                                                                        |

Each route names its permission and each service method checks it again with `ctx.authz.require`. The scoped permission is the one
resource-scoped case: the route `PUT /kpi/services/{id}/kpis` names the plain `set.read` (ADR-0034: every signed-in person holds it) and
`serviceKpis.set` calls `ctx.authz.require(actor, 'kpi.framework.service.kpis.edit', { type: 'service', id })`. The module contributes
its own `authz.resourcePolicy` entry for the resource type `service`; it asks `registry.services` (`isProviderManagerAsSystem`) whether the
user is an approved manager of the service's provider (a plain member reads and does not change), so the rule of ADR-0036 is written once and read at every call. The order
is 404 (the service), 403, then 422; a plain member, a manager of another provider, a requested or left membership and a person with no membership are
refused, and a removal is seen at the next call. Admin holds every declared permission
without a grant (core.authz); the `user` grants are the module's `authz.defaultRole` contribution.

## Routes (internal API)

| Route                                       | Permission                                                      | Notes                                                                                                                                                                                                                                     |
| ------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /kpi/indicators`                       | `indicator.read`                                                | `q` (name, slug, description; `%` and `_` are literal), `thematic`, `unit`, `qualitative`, `sort` (`name`, `thematic`, `unit`, `valueType`; ties by name, then id), `page` from 0, `pageSize` 1 to 100                                    |
| `POST /kpi/indicators`                      | `indicator.manage`, audited                                     | 201; slug made from the name when not given; 409 names `name` or `slug`; 422 names every bad path                                                                                                                                         |
| `GET`, `PUT`, `DELETE /kpi/indicators/{id}` | read / manage, audited                                          | `PUT` replaces the editable fields (a field left out is cleared; the slug never changes); `DELETE` is 409 `kpi-in-use` while a set row or an evaluation uses it                                                                           |
| `GET /kpi/value-types`                      | `indicator.read`                                                | the registry entries (id, labels, `numeric`, `range`, `aggregates`), by id                                                                                                                                                                |
| `GET /kpi/sets`                             | `set.read`                                                      | `q`, `rimoCategory`, `sort` (`name`, `rimoCategory`); each row has `indicatorCount` and `necessityCounts` for the badges                                                                                                                  |
| `POST /kpi/sets`                            | `set.manage`, audited                                           | 201; the set has no rows yet                                                                                                                                                                                                              |
| `GET`, `PUT`, `DELETE /kpi/sets/{id}`       | read / manage, audited                                          | the detail has the rows and the evaluation; `DELETE` removes rows and evaluation (a service that uses the set blocks it from sprint 3)                                                                                                    |
| `PUT /kpi/sets/{id}/indicators`             | `set.manage`, audited                                           | replaces the rows in one transaction (add, change necessity, remove); an empty necessity, an unknown term or indicator and a repeat are 422 naming `indicators[i].…`; removing the headline clears the evaluation in the same transaction |
| `GET /kpi/services/{id}/kpis`               | `set.read`                                                      | the set (with its IRI), the effective rows (`necessity`, `source` `set` or `extra`), the stored extras and `canEdit`: whether the caller may change them; 404 for an unknown service                                                      |
| `PUT /kpi/services/{id}/kpis`               | `set.read` + scoped `service.kpis.edit` in the service, audited | body `{ setId \| null, extras: [id] }` replaces the set and the extras in one transaction; an unknown set or indicator is 422 naming `setId` or `extras[i]`; an extra the new set contains is dropped; 403 for a caller who may not       |
| `GET`, `PUT /kpi/sets/{id}/evaluation`      | read / manage, audited                                          | `GET` answers `{ evaluation: null }` without a headline; `PUT` needs a headline that is a row of the set and an aggregate that the value type allows and the vocabulary has active                                                        |

Lists use the legacy envelope (`{ metadata, result }`, 0-based pages). An unknown id is 404, a malformed one 422, an unknown term 422 with
the path, a duplicate name or slug 409, never a 500. Every string and list is bounded (names 200, descriptions 4000, examples 1000, 50
terms per link list, 500 rows per set). Responses carry `iri` (`<base>/kpi/<kind>/<slug>`, base from the setting `iriBase`).
Internal routes are not part of the public v1 document.

### The public API (v1)

Two additive reads in the legacy shape (ADR-0037); the permission is `kpi.framework.v1.read`, held by the role `user` by default, and no
read is anonymous. Sorted by name without case, then id; pages from 0; `pageSize` at most 100 (default 100); an unknown parameter is 422.

| Route                                       | Legacy fields                                                                                                             | Added                                                                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/categories`                    | `name` (the KPI set)                                                                                                      | `id`, `iri`, `description`, `rimoCategory` (the RIMO IRI or `null`), `indicators` (how many)                                        |
| `GET /api/v1/indicators?category=&service=` | `name`, `description`, `type` (`number` for an integer, else the value type), `thematicCategory`, `selected`, `necessity` | `id`, `iri`, `example`, `valueType`, `qualitative`, `unit` (`{ key, symbol, iri }`), `min`, `max`, `measuredBy`, `canBeAutomatedBy` |

`category` (a KPI set name, without case) keeps the indicators of that set and gives their necessity there. `service` (an abbreviation,
without case) marks the indicators of its effective set as `selected` and, without `category`, gives their necessity there; it does not
remove the others. `totalCount` is the size of the filtered set (**defect 15**: the legacy count ignored the filters). A `category` or
`service` that names nothing is 422 naming the parameter. The service row of `GET /api/v1/services` gains `category` (the name of the
service's KPI set, `null` without one) and a `category` filter, contributed through the `service.facet` entry (see below). The unit is the
Units Ontology IRI for a seeded unit, an IRI minted here for an administrator's own. The same definitions as RDF are `GET /api/v1/kpi/rimo.ttl`
and `.jsonld` (next section).

### The RDF reads (Turtle and JSON-LD)

The indicators and KPI sets as RDF that follows RIMO 0.2.0 ([ADR-0040](../../docs/adr/0040-indicators-follow-rimo.md), the mapping table of
[the plan](../../docs/m9-sprint-plan.md) §3), in two pairs of routes over **one model**:

| Route                                                                                                              | Who                                                            | Cache and format                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/kpi/rimo.ttl` and `GET /api/v1/kpi/rimo.jsonld`                                                       | `kpi.framework.v1.read` (a token with the scope, or a session) | `text/turtle` or `application/ld+json`, UTF-8, `Cache-Control: private, no-cache`, `X-Content-Type-Options: nosniff`; audited like the other v1 reads |
| `GET /public/kpi/rimo.ttl` and `GET /public/kpi/rimo.jsonld` (the internal surface, like `/public/services/{ref}`) | anyone, no token, no cookie                                    | the same bytes, `Cache-Control: public, max-age=300` and a strong ETag (the hash of the bytes); `If-None-Match` gets 304                              |

Neither takes a query parameter (422), and a profile without this module has neither. The public pair gives **definitions only**: the model
(`buildRdfModel`, one tested query function in [service/rdf-model.ts](service/rdf-model.ts)) has no field for a service, a person, a
measurement or a token, so no route can say one; today the two pairs serve the same model and differ in who may ask and how the answer is cached.
When M10 adds values, the model keeps them out and the public pair stays definitions. There is no setting that switches the public pair off
(backlog).

What the document says, in Turtle (the JSON-LD has the same triples; both are rendered from one graph in [service/rdf.ts](service/rdf.ts),
pure and without a dependency):

- A **catalogue node** `<base>/kpi/catalogue/rimo` with `dct:conformsTo <http://w3id.org/RIMO>` and `dct:hasVersion "0.2.0"`: the version the
  export follows.
- Each indicator is a `rimo:KPI` with `rimo:KPIName`, `rimo:KPIDescription` and `rimo:KPIExample` (when present), `rimo:isQualitativeIndicator`,
  `scorpion:thematicCategory` (the thematic category as a literal, since RIMO has no term; the namespace `scorpion:` is `<base>/kpi/ns#`),
  `rimo:measuredBy` and `rimo:canBeAutomatedBy` (minted IRIs typed `rimo:MeasurementMeans` and `rimo:AutomationTool`, with the vocabulary key as
  `skos:notation`), and `rimo:mandatoryFor`, `rimo:recommendedFor` or `rimo:appliedTo` **from the indicator to the category**.
- One `rimo:hasValue` node `<indicator IRI>#value`, a `rimo:KPIValue` that carries `rimo:hasUnit` (the Units Ontology IRI of a seeded unit,
  else the IRI minted here), `scorpion:unit` (always the minted unit, which keeps `request` apart from `user` although both are a UO
  `count unit`), `scorpion:valueType`, and `scorpion:minValue` and `scorpion:maxValue` as `xsd:decimal`. M10's real values will reuse this node.
- Each used unit is a `scorpion:Unit` (`skos:notation`, `scorpion:symbol`, `skos:closeMatch` to the UO term).
- A KPI set that **maps to a RIMO category is that category** (`http://w3id.org/RIMO#Web_application`, typed `rimo:ServiceCategory`; RIMO defines
  its words, so none are repeated); one that does not is a `rimo:ServiceCategory` minted as `<base>/kpi/set/<slug>` with `skos:prefLabel` and
  `dct:description`. Two sets that map to the same RIMO category are one category, and an indicator keeps the **strongest** relation any of them
  gives it (mandatory over recommended over the rest); the name of a mapped set is therefore not in the export (the v1 `categories` read has it).
  A necessity that is neither `mandatory` nor `recommended` (an administrator's own term) is `rimo:appliedTo`, like `optional`.
- Only the units, means and tools an indicator uses appear. Nothing is seeded: a fresh instance writes the catalogue node alone.

The order is fixed (the catalogue, the categories, the units, the means, the tools, then each indicator with its value node, each list sorted
by IRI), so the same data gives the same bytes whatever the order the rows were written in; the ETag follows from that.

**Safety.** No free text becomes an IRI: every IRI is `iriFor` (a slug that a check constraint restricts to `[A-Za-z0-9._-]`, joined to a
validated base) or comes from code and the seed, and `assertIri` refuses anything but a plain `http(s)` IRI (no space, control character,
`<>"{}|^`` ` ``\`, non-ASCII, or empty host) before it is written. Free text is written only as a literal: `turtleString` escapes `\`, `"`, the
line breaks and every control character (C0, DEL, C1), the line and paragraph separators, and replaces a lone surrogate with U+FFFD;
JSON-LD goes through `JSON.stringify` with `<`, `>`, `&` and the line separators escaped. A decimal bound is checked against a pattern
before it becomes a typed literal. The tests load both formats with `n3` and `jsonld` (**dev dependencies of the tests only**, ADR-0040
addendum) and compare the triples, with names that hold quotes, line breaks, backslashes, angle brackets, NUL, a lone surrogate, Turtle
syntax, an injected statement and 90 000 characters.

**The IRIs identify; they do not dereference.** The IRI of a deleted indicator is not reserved: a later indicator with the same name gets the
same IRI (ADR-0040 addendum, decision 7), so rename an indicator instead of deleting and re-creating it. Nothing serves a page at `<base>/kpi/indicator/<slug>`. The two public routes are fixed
addresses that serve the whole catalogue. Set `iriBase` before you share an identifier (see "Settings").

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

## The wizard step, the service section and the facet

What the module contributes to `registry.services` (it holds no code there beyond the entries; see ADR-0040, addendum of sprint 3):

| Registry                            | Entry                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `service.fieldType`                 | `kpi-set`: the value is `{ setId \| null, extras: [id] }`, widget `kpi-set`, storage `module` (its own tables, not `svc_field_value`); `check` answers 422 on the field for an unknown set or indicator; `choices` lists the sets by name (config `rimoCategory` narrows them to one RIMO service category); `store` writes in the create transaction |
| `service.wizardStep`                | `kpi-set`, order 40 (after the three steps of `registry.services`): one optional field `kpiSet`                                                                                                                                                                                                                                                       |
| `service.facet`                     | `kpi-set`: counted per set, `emptyLabel` "No KPI set", `unknownOf` (a value that is no set id is 422), `labelsOf` (the set's name), and `v1` (the `category` of the v1 row and its filter)                                                                                                                                                            |
| `authz.resourcePolicy` (core.authz) | resource type `service`, for the permission `kpi.framework.service.kpis.edit`                                                                                                                                                                                                                                                                         |

**The wizard step.** A person picks a KPI set (the sets come with the schema, so the step asks the API for nothing until a set is chosen),
sees its indicators locked with their necessity, and adds extras found by a search. The value is sent in the one `POST /services` body at
`kpiSet`. The server writes it **inside the transaction that creates the service** (the field type's `store`, called with the new
service's id), emits `kpi.serviceSet.changed@1` there, and a failure of any part takes the service back: no service, no set row, no extras
(tested with a failing event insert and a failing KPI table). A `PATCH /services/{id}` that names `kpiSet` is 422: the KPIs change through
`PUT /kpi/services/{id}/kpis`. The plan said the module _consumes_ `registry.service.created@1`; the outbox delivers after the commit, so
that could not be one transaction, and the field type's `store` is the same idea made atomic.

**The service section.** The service page draws the section "KPIs" after the record (a section registered through the module's
`wizardExtensions` export): the set with the necessity of each indicator, the extras with their units, and, when `canEdit` is true, the
way to change them (the same editor as the wizard, saved in one request). It reads from the one `GET /kpi/services/{id}/kpis`.

**The facet and the filter.** `GET /services/facets` lists the sets with counts and "No KPI set"; `GET /services?kpi-set=<id>` (several
ids are OR, `:none` is the services without one) filters by it; the catalogue page keeps it in its address as `?f.kpi-set=<id>`.

**Calls added to a page that already loads.** The loaders of the pages run on the server and are unchanged. What the browser sends itself:
the service page one `GET /kpi/services/{id}/kpis` and, the first time in a session and only when the service has rows, two reads of the
vocabularies `necessity` and `kpi.unit` for the words (kept in memory, so a second visit asks nobody); editing adds one `GET /kpi/sets`.
The wizard step none on arrival (the sets are in the schema's `choices`); when a set is chosen one `GET /kpi/sets/{id}` (and the two
vocabulary reads the first time); each search for extras one `GET /kpi/indicators`. `apps/web/e2e/kpi-framework.spec.ts` counts them, writes the
calls into the report of the run as annotations and prints them as `[kpi-calls]` lines. **Measured in sprint 4** (the same on both base
paths): service page, first visit, `GET /kpi/services/{id}/kpis` and the two vocabulary reads; second visit in the same session, the one
`GET /kpi/services/{id}/kpis`; wizard step on arrival, none; a set chosen, `GET /kpi/sets/{id}` and the two vocabulary reads (the first time);
a search for extras, one `GET /kpi/indicators`. The target "none on a page that already makes four" is met for the wizard on arrival
and not met for the service page (one call on every visit, two more the first time): see the backlog.

**Measured in sprint 4, on a development machine** (Postgres in a container, one process; 200 indicators with a unit, text and a few means,
tools and 10 sets of 20 to 60 rows, 4 of them unmapped): `GET /api/v1/kpi/rimo.ttl` 180 kB (7.4 kB gzip), `.jsonld` 254 kB (8.2 kB gzip),
median 16 ms and 13 ms (the model alone 5.5 ms, the Turtle writer 5.3 ms, the JSON-LD writer 1.9 ms); a fresh instance (no indicator is seeded) writes
405 bytes of Turtle. `GET /api/v1/indicators?pageSize=100` median 8 ms for page 0 and 10 ms for page 1, `?category=` 6 ms.

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
`apps/web/e2e/kpi-framework.spec.ts`. Sprint 3 adds: the property tests of the effective set ([service/merge.test.ts](service/merge.test.ts)),
`serviceKpis` with its denied, rollback and event cases ([service/service-kpis.test.ts](service/service-kpis.test.ts)), the wizard step,
the facet and the v1 `category` with both modules on real Postgres ([service/wizard.test.ts](service/wizard.test.ts)), the v1 reads
([service/v1.test.ts](service/v1.test.ts)), `apps/server/src/kpi.contract.test.ts` (the contract test of the two v1 routes),
`apps/server/src/defect-14.service-kpis.test.ts` and `defect-15.v1-kpi-totalcount.test.ts`, `apps/web/src/kpi-service-parts.test.ts`, and the
journey (a service with a set and an extra, then the set changed and the extra removed, under both base paths) and axe in both themes for
the wizard step and the service section. Sprint 4 adds the writer ([service/rdf.test.ts](service/rdf.test.ts): the escaping functions table-driven, both formats loaded with `n3` and
`jsonld`, hostile names, two committed snapshots in `service/__snapshots__/`), the model query and the service
([service/rdf-model.test.ts](service/rdf-model.test.ts)), the contract tests of the two v1 reads (`apps/server/src/kpi.contract.test.ts`), the public pair, the
no-leak test and the denied cases (`apps/server/src/kpi-rdf-routes.test.ts`), and the journey from the indicator form to the RDF read and the
navigation entries (`apps/web/e2e/kpi-framework.spec.ts`, `shell.spec.ts`). Factories: `makeIndicator`, `makeKpiSet` and `makeServiceKpis` in `packages/testing`.
