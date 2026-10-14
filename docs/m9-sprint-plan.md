# M9 Sprint Plan: `kpi.framework`, with indicators that follow RIMO

Status: **decided**, 2026-10-14. The maintainer answered six questions while this was drafted and approved the six proposals that followed (all recorded in §13).
Scope source: [implementation.md](implementation.md) §4, M9 and Gate 2, [architecture.md](architecture.md) (the `kpi.framework` row of the module table, §4 "kpi-set wizard step", the `kpi.valueType` registry), FEATURES §3.6 and §3.16 and defect 14 (KPI part) and defect 15 (`totalCount` of indicators) ([FEATURES.md](FEATURES.md) §5), and the **Research Infrastructure Metrics Ontology (RIMO) 0.2.0** ([RIMO.ttl](https://github.com/JKoblitz/BH25-metrics/blob/main/RIMO.ttl), CC BY 4.0, BioHackathon Europe 2025 METRICS team).

M9 is size M in `implementation.md`. This plan has **four sprints (about four weeks for one developer)**: the RIMO structure adds a seed, minted IRIs and two RDF reads to the old scope, and it is the first milestone that contributes a wizard step and a section to `registry.services` from another module. Releases as `0.11.0` (`0.10.0` is M8, released 2026-10-14). Gate 3 follows M13.

## 0. Before sprint 1

State on 2026-10-14 (checked against `dev` after the merge-back of `0.10.0`):

1. **Gate 2 is conditionally passed** (ADR-0039, written in sprint 1; Decision 1). Every line of the gate holds except "runs on staging with real organisation and service data from a partial migration dry run", which needs the migration tool of M13 and the maintainer's staging. The evidence is in [m8-sprint-plan.md](m8-sprint-plan.md) §12. If the dry run finds a gap, the fix goes into the milestone then in progress and the gate stays open until it is closed.
2. **What exists to build on** (checked in the source, not assumed):
   - The five `registry.services` registries (`service.fieldType`, `service.wizardStep`, `service.facet`, `service.orgRole`, `service.profileContributor`) with a fixture that contributes one of each ([modules/registry-services/README.md](../modules/registry-services/README.md), "How to add …"). `fieldValueFacet()` serves a facet over a value in `svc_field_value`.
   - The vocabularies `thematic-category`, `necessity` and `aggregate` are declared and seeded by `core.settings` with **no `usage` check** ([backlog.md](backlog.md), "Usage checks for the built-in vocabularies"). M9 is the module that starts storing their keys, so it adds the entries and calls `validateTerm` on save.
   - `RouteRegistrar.public('v1', …)`, the contract-test harness with the walker that fails a v1 route without a contract test, `pnpm openapi:diff` against the last release tag (`v0.10.0` is the first contract: M9 can only add to it), the security schemes in the spec and the reference page at `/docs/reference` (M8).
   - `serializeJsonLd` (`registry.organisations/public`) and the Schema.org builder of `registry.services`: the patterns for a `application/ld+json` read and its escaping.
   - `kpi.reporting-reminder` and other templates of modules that do not exist yet live in `core.notifications` (backlog); they are M10's.
3. **Known gaps this plan has to settle** (from the backlog): how the `ui` entry of a contributing module reaches the wizard (`registerFieldWidget`, `registerStepApplies`; sprint 3); a step whose `applies` hides it cannot have a required field (sprint 3); the `category` and `values` keys the v1 service row lacked until M9 (sprint 3, additive); a service delete needs a `service.usage` check that KPI modules contribute (sprint 3 contributes it; the delete itself stays out of scope).
4. **Prototype in the first days of sprint 1** (stop and say so if it fails): read `RIMO.ttl` with the small extractor of Decision 9 and write `config/rimo-seed.json` (the 16 service categories with IRI, label and comment, the ontology version); render one fixture indicator and one fixture KPI set as Turtle and as JSON-LD by hand and load both with a real Turtle parser in a throwaway script (for example `n3`, **not** added to the repository) to prove that the output is valid and has the triples of §3. If a hand-written serialiser cannot be made valid with the escaping rules of §3, stop: the fallback is a development-time parser dependency for the tests only.
   **Corrected in sprint 1:** `RIMO.ttl` (commit `5ead6c6`) has **16** `rimo:ServiceCategory` instances, not 17; every mention of 17 in this plan and in `implementation.md` now says 16.
5. **Lessons of M7 and M8 applied from the first sprint:** unique names, slugs and ids in tests (specs share a database); no regex built from a variable in a test (CodeQL); `docs/security/**` maps to all four ASVS chapters, so a pull request that changes it updates the matching chapter file or carries `asvs-no-impact` with a true reason; the release runs `pnpm security:asvs --release`, so the maintainer bumps `assessed_commit` before the release branch is cut; a load a shell repeats on every navigation costs API calls (the wizard step and the service section must add none to pages that already make four).

## 1. What earlier milestones hand to M9

| Hand-off                                                                                                                                    | Where it was recorded                          | Sprint |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------ |
| The `kpi-set` wizard step and the service-detail section, contributed through the `registry.services` registries                            | implementation.md M9, architecture.md §4       | 3      |
| The category facet of the catalogue (`fieldValueFacet`-style, with `labelsOf`)                                                              | backlog (services sprint 4), ADR-0035 addendum | 3      |
| How a contributing module's `ui` entry reaches the wizard (`registerFieldWidget`, `registerStepApplies`)                                    | backlog (services sprint 5)                    | 3      |
| `usage` checks and `validateTerm` for `thematic-category`, `necessity`, `aggregate`                                                         | backlog (built-in vocabularies)                | 1, 2   |
| `category` and `values` in the v1 service row; v1 `categories` and `indicators` with `totalCount` that respects filters (defect 15)         | backlog (v1 follow-ups), FEATURES §3.16        | 3      |
| A `service.usage` check for a future service delete                                                                                         | backlog (services sprint 2)                    | 3      |
| Defect 14, KPI part: removing extra KPIs works, an unknown category is 422, the writes are transactional, a necessity of `''` is impossible | FEATURES §5, §3.6                              | 2, 3   |
| Measurements, values per period, the `POST /api/v1/measurements` write, reminders                                                           | implementation.md M10                          | none   |

## 2. Cross-sprint rules

- Stay inside M9. Anything else goes to `docs/backlog.md` (§11).
- **One pull request per sprint** (CLAUDE.md). ADRs, READMEs, backlog lines, the regenerated OpenAPI document and review fixes go into the sprint's pull request; push when the sprint is complete and verified (`pnpm check`, the tests of every package touched, `pnpm test:contract`, the e2e of any journey touched). A release is its own pull request (CONTRIBUTING).
- **The module is `kpi.framework`** (`modules/kpi-framework`, package `@scorpion/kpi-framework`) with the usual layers. It depends on `registry.services` (it contributes to its registries) and `core.settings`; `registry.services` does **not** depend on it (architecture §4). It reads services only through `registry.services/public`; it holds no foreign key to a service (a plain column, as M7 did for organisations).
- **Everything the model names is data.** Value types are a registry (`kpi.valueType`); stages of necessity, thematic categories, aggregates, units, means of measurement, automation tools and the RIMO service categories are vocabularies. No pg enum (a test fails on one), no hard-coded list.
- **RIMO is the shape, not a runtime dependency.** The ontology's classes and properties name our tables and fields (§3); a committed copy of the file and a seed generated from it are the only coupling. Nothing fetches RIMO at runtime or in CI.
- **Public v1 changes are additive.** `categories` and `indicators` keep the legacy names and types; every RIMO field is new (§7). The diff job guards it.
- **A v1 route is declared once** with `createRoute()` in this module and registered with `r.public('v1', …)`; one permission per route family, `kpi.framework.v1.read`, granted to the role `user` by default (M8 Decision 1); no anonymous v1 read; a stable sort (key, then id); bad input is 422.
- **Transactions and events.** Every write of more than one row runs in `ctx.db.tx()` with the event in the outbox in the same transaction; a rollback test per such method.
- **Permissions are checked twice** where a resource is involved (the route and `ctx.authz.require` in the service). Nobody approves or changes their own role here, so no new self-service rule arises; the service-scoped permission of sprint 3 follows ADR-0036.
- **No hard-coded branding.** IRIs, titles and contact in the RDF reads come from settings (Decision 5); no word of the instance in a message.
- Update the module README with every manifest change. No new runtime dependency (Decisions 9 and 10); a development dependency is named in the pull request description.
- Every pull request carries a changeset (package `scorpion`); sprints 1 to 4 are `minor` where an operator or API user can see something, `patch` otherwise.

## 3. How RIMO maps to the model

This table is the structure. ADR-0040 (sprint 1) records it.

| RIMO                                               | Scorpion                                                                                                                                                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `rimo:KPI`                                         | an **indicator** (`kpif_indicator`)                                                                                                                                                                                            |
| `rimo:KPIName`, `KPIDescription`, `KPIExample`     | `name`, `description`, `example` (plain text, bounded; the example is new)                                                                                                                                                     |
| `rimo:isQualitativeIndicator`                      | `qualitative` (boolean). A qualitative indicator has the value type `text` (the value types of M9: integer, float, text, duration, percentage); a quantitative one may be any                                                  |
| `rimo:hasValue` → `rimo:KPIValue`                  | the value an indicator takes: its type, unit and bounds. **Values themselves are M10's**; the RDF read gives each indicator one `rimo:KPIValue` node that carries the unit                                                     |
| `rimo:hasUnit` (range Units Ontology)              | `unit`: a term of the vocabulary `kpi.unit`; a seeded term carries its UO IRI and its symbol from `config/units.ts`, an administrator's own term has neither (Decision 3)                                                      |
| `rimo:measuredBy` → `rimo:MeasurementMeans`        | zero or more terms of the vocabulary `kpi.measured-by` (many-to-many, `kpif_indicator_means`)                                                                                                                                  |
| `rimo:canBeAutomatedBy` → `rimo:AutomationTool`    | zero or more terms of the vocabulary `kpi.automation-tool` (`kpif_indicator_tool`)                                                                                                                                             |
| `rimo:requestedBy` → `foaf:Agent`                  | **not in M9** (Decision 2, backlog): an organisation reference needs `registry.organisations` as a dependency and a usage check                                                                                                |
| `rimo:ServiceCategory`                             | the seeded vocabulary `kpi.service-category` (16 terms, each with its `w3id.org/RIMO#` IRI from `config/rimo-seed.json`); **a KPI set optionally names one** as `rimo_category`                                                |
| `rimo:appliedTo`, `mandatoryFor`, `recommendedFor` | a row of a KPI set (`kpif_kpi_set_indicator`) with a `necessity` term. `mandatory` → `mandatoryFor`, `recommended` → `recommendedFor`, `optional` → `appliedTo`. RIMO has no "optional" subproperty; the base property is used |
| (no RIMO term)                                     | `thematic` (Bibliographic, Usage, Technical, Satisfaction): kept as the legacy vocabulary `thematic-category`; the RDF read gives it as the literal `scorpion:thematicCategory`, since RIMO has no term for it (Decision 4)    |

A **KPI set** is the old "category": freely named by an administrator and assigned to services; `rimo_category` is the mapping to RIMO. A set with no mapping is exported as a `rimo:ServiceCategory` we mint.

**IRIs.** Every indicator, KPI set, unit, means and tool has an IRI `<base>/kpi/<kind>/<slug>`; the slug never changes (like a service slug). `<base>` is the setting `kpi.iriBase`; empty means the origin and base path of the request, which is correct for one deployment and wrong for an IRI that must survive a move, so the README says to set it. A seeded RIMO category keeps `http://w3id.org/RIMO#<Name>`.

## 4. Sprint overview

| Sprint | Branch                       | Theme                                                                                                                                                   | Closes                                                 |
| ------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 1      | `feature/m9-kpi-model`       | ADR-0039 and ADR-0040, the module, the tables, the vocabularies and their usage checks, the value types, the RIMO copy and seed, the IRIs               | none                                                   |
| 2      | `feature/m9-kpi-indicators`  | Indicators and KPI sets: service layer, internal routes, the admin pages, the evaluation configuration                                                  | defect 14 (writes, necessity, 422)                     |
| 3      | `feature/m9-kpi-services`    | The service link, the effective KPI set, the wizard step, the service section, the facet, the v1 `categories` and `indicators`, the `ui` entry question | defect 14 (extras, category change), 15 (`totalCount`) |
| 4      | `feature/m9-kpi-rdf-release` | The RDF reads (Turtle, JSON-LD), journeys, axe, ASVS and security docs, the backlog, the release                                                        | none                                                   |

## 5. Sprint 1: the model, the vocabularies, the RIMO seed

**Branch:** `feature/m9-kpi-model`. **Goal:** `kpi.framework` loads in the `full` profile, its tables migrate, its vocabularies are declared and checked, and RIMO is in the repository as data.

Work items

1. **ADR-0039** (Gate 2 passes conditionally while the staging dry run waits for M13, like ADR-0031) and **ADR-0040** (the indicator model follows RIMO: the table of §3, the IRI rule, what RIMO terms are not used and why, the version of RIMO and how a new one is adopted). The lines of §12 go into `implementation.md` in the first commit.
2. **Create `modules/kpi-framework`:** `module.ts` (id `kpi.framework`, `tablePrefix: 'kpif_'`; the loader checks it, and `kpi.ingestion` will use `kpii_`), `public.ts`, `README.md`, `package.json` (exports `./module`, `./public`, `./ui`; dependency `@scorpion/registry-services`), `db/schema.ts`, `migrations/`, `routes.ts`, `service/`, `config/`. `pnpm modules:sync`; the `full` profile lists it; `profile:generate` and `openapi:generate` leave no diff.
3. **Tables** (`pnpm db:generate --filter @scorpion/kpi-framework`):
   - `kpif_indicator`: `id` (UUIDv7), `slug` (unique without case, same rules as a service slug, never changes), `name` (unique without case, 1 to 200), `description`, `example`, `qualitative`, `value_type` (a key of `kpi.valueType`), `unit` (a `kpi.unit` term or null), `min_value` and `max_value` (nullable `numeric`, only for a numeric type, `min <= max`), `thematic` (a `thematic-category` term), audit columns.
   - `kpif_indicator_means` and `kpif_indicator_tool`: `(indicator_id cascade, term_key)`, unique.
   - `kpif_kpi_set`: `id`, `slug`, `name` (unique without case), `description`, `rimo_category` (a `kpi.service-category` key or null), audit columns.
   - `kpif_kpi_set_indicator`: `(set_id cascade, indicator_id restrict)`, `necessity` (a `necessity` term), primary key `(set_id, indicator_id)`.
   - `kpif_evaluation`: `set_id` (unique, cascade), `indicator_id` (must be in the set), `aggregate` (an `aggregate` term).
   - The service tables of sprint 3 arrive then. A test fails on a pg enum and on a table without the prefix.
4. **The `kpi.valueType` registry** (declared by this module; entry `{ id, labels, schema(config) → Zod, parse, format, aggregates, numeric }`; Zod-checked by the loader): `integer`, `float`, `text`, `duration` (`HH-MM-SS` → seconds, range-checked), `percentage` (0 to 100, float). Pure, table-driven tests (valid, invalid, bounds, edge of `duration`, `percentage`). `kpi.ingestion` (M10) and `kpi.analytics` (M11) use the same entries.
5. **Vocabularies:** declare and seed `kpi.unit` (count, percent, second, byte, request, user, publication, citation, each with its UO IRI and symbol in `config/units.ts`, labels en and de), `kpi.measured-by` and `kpi.automation-tool` (declared, empty: RIMO names the classes and no instances), `kpi.service-category` (the 16 terms of the seed). Add the `usage` entries: a `necessity` term used by a set row, a `thematic-category` term used by an indicator, an `aggregate` term used by an evaluation, a `kpi.unit` term used by an indicator, a `kpi.measured-by` or `kpi.automation-tool` term linked to an indicator, a `kpi.service-category` term named by a set are deactivated and never deleted. `validateTerm` runs on every save.
6. **RIMO as data:** `config/rimo/RIMO.ttl` (the file as published, with its licence line and the commit it was taken from in the README), `scripts/rimo-seed.ts` (a small extractor for the regular shape of that file: it fails loudly on a shape it does not know, with tests on a fixture of each construct) that writes `config/rimo-seed.json` (ontology IRI and version, the categories with IRI, label and comment), and a drift test that regenerates the seed and compares. `README` carries the CC BY 4.0 attribution.
7. **IRIs:** `service/iri.ts` (pure: `iriFor(kind, slug, base)`, the base from `kpi.iriBase`; table-driven tests including a base with a trailing slash, a base path and a slug that needs no escaping). Setting `kpi.iriBase` (a URL or empty, validated) in the module's settings schema.
8. **Events** declared: `kpi.indicator.changed@1`, `kpi.set.changed@1` (ids and field names only; used in sprint 2). Added to the `core.audit` decisions table (logged, not critical) and its README.
9. **README and backlog.** The module README (id, permissions as far as they exist, settings, vocabularies, registries declared, tables, "how to add a value type"). Backlog lines for what the sprint touched.

ASVS impact (sprint 1): the pull request regenerates the route table only if a route exists; otherwise nothing in `docs/security/**` changes. If it does, the label `asvs-no-impact` with `ASVS impact: none because the generated route table gained rows of a new module and no rule or control changed`.

Tests (sprint 1): the loader accepts the module and rejects a table without the prefix; the value types table; the seed drift test; the extractor fixture tests; the usage checks (a term in use is deactivated, an unused administrator term is deleted); `validateTerm` refuses an inactive term on save; IRI table.

Definition of done: `pnpm check`, `pnpm test --filter @scorpion/kpi-framework` and the full `pnpm test` pass; `profile:generate` and `openapi:generate` leave no diff; the image jobs hold exactly the profiles' modules.

## 6. Sprint 2: indicators and KPI sets

**Branch:** `feature/m9-kpi-indicators`. **Goal:** an administrator creates, edits, deletes and lists indicators and KPI sets in the browser and through the internal API, all transactional.

Work items

1. **Permissions:** `kpi.framework.indicator.read` and `.manage`, `kpi.framework.set.read` and `.manage`; read for User and Admin, manage for Admin. Declared with descriptions; the route table is regenerated.
2. **Service layer** (every method takes the `actor`; `ctx.authz.require` in each write): `indicators.create|update|delete|get|list`, `sets.create|update|delete|get|list`, `sets.setIndicators(setId, rows)` (replaces the rows of a set in one transaction: add, change necessity, remove; a necessity must be an active `necessity` term, never `''`), `evaluation.get|set` (one headline indicator in the set and an aggregate the indicator's value type allows). Renaming never changes a slug; deleting an indicator that a set row, an evaluation or (from sprint 3) a service uses is a 409 that names the module and the count; deleting a set that a service uses is the same. List endpoints: `q`, `thematic`, `qualitative`, `unit`, sort (key, then id), the envelope with 0-based pages.
3. **Routes** (`createRoute()`, internal surface): `GET|POST /kpi/indicators`, `GET|PUT|DELETE /kpi/indicators/{id}`, `GET|POST /kpi/sets`, `GET|PUT|DELETE /kpi/sets/{id}`, `PUT /kpi/sets/{id}/indicators`, `GET|PUT /kpi/sets/{id}/evaluation`, `GET /kpi/value-types`; the writes have `audit: true` and emit the events in the same transaction. Unknown id 404, unknown term 422 naming the path, a duplicate name or slug 409.
4. **Pages** (through the registry `ui.routes`, base path through `url()`): `/kpi/indicators` (list with the filters, create and edit form with the RIMO fields, a unit select, the two multi-selects), `/kpi/sets` (list with necessity badges, edit page: the paginated indicator picker, necessity per row, the evaluation indicator and aggregate), `ui.nav` entries under the services section for the right permission. Words in en and de; no hard-coded instance vocabulary or branding in a message.
5. **Defect 14 (KPI part):** regression test `defect-14.kpi-sets.test.ts`: a set write is atomic (a failed second row leaves no first row, proved with a failing event insert), a necessity of `''` and of an unknown term is 422, a name with a space or a percent sign in a URL works (ids are in the path, names are never parsed from it).
6. **README, backlog, OpenAPI regeneration** (internal routes are not in the v1 document).

ASVS impact (sprint 2): the route table is regenerated; `asvs-no-impact` as in sprint 1 unless a rule changed.

Tests (sprint 2): integration tests per service method against real Postgres, each with a denied-permission case (a plain User may read and not write) and a rollback case for the multi-row writes; the 409 on delete; the evaluation rules; route tests with 404, 409 and 422; the page tests (the form, the pickers, both languages, axe in both themes under both base paths); the journey "create an indicator, build a set, set the evaluation".

Definition of done: as sprint 1, plus `CI=true pnpm test:e2e` green for the new journey.

## 7. Sprint 3: services, the wizard step, the facet and v1

**Branch:** `feature/m9-kpi-services`. **Goal:** a service has one KPI set and may opt into extra indicators; the wizard and the service page show and change them; the catalogue filters by set; v1 serves `categories` and `indicators` additively.

Work items

1. **Tables:** `kpif_service_set` (`service_id` plain column, unique; `set_id` restrict) and `kpif_service_extra_indicator` (`service_id`, `indicator_id` restrict; unique pair). No foreign key to `svc_service`; the service layer checks existence through `registry.services/public`.
2. **The effective KPI set** as **one tested query function**: the set's rows (with necessity) plus the extra indicators that are not already in the set (necessity `optional`); an indicator in the set cannot be an extra. Property tests: no duplicates, the set's rows are never removed by an extra, the order is stable.
3. **Service layer:** `serviceKpis.get(serviceId)`, `serviceKpis.set(serviceId, { setId, extras })` (one transaction: **replaces** the set and the extras; an unknown set or indicator is 422, never 500; a removal of an extra works; an extra that the new set already contains is dropped), the event `kpi.service-set.changed@1`. Permission `kpi.framework.service.kpis.edit` with `scope: 'service'`, checked at the route and in the service with `ctx.authz.require(actor, permission, resource)`; it follows the policy `service.member` of ADR-0036 (members of the provider and Admin). `service.created` is consumed: a service created through the wizard has its set and extras written in the same transaction as the service (see item 5) or not at all.
4. **`ui` entry question settled.** The shell forwards a fourth export of the `ui` entry, `wizardExtensions: { widgets, applies }`, to `registerFieldWidget` and `registerStepApplies` (the smaller change than a second widget list; ADR-0040 addendum). The fixture of the wizard page test goes through the same path. **Conditional required fields:** the server learns a serialisable `showIf` on a field and a step (a pointer and a value test), so a hidden step can have required fields. If this turns out to touch the validation of `registry.services` beyond the field config, stop and say so.
5. **The `kpi-set` wizard step** (`service.wizardStep`, order after the module's own steps): a select of the sets (the active ones; an optional filter by `rimo_category`), the effective KPIs shown locked by necessity, a picker for extras. Values land through the `service.fieldType` `kpi-set` (widget `kpi-set`) so the existing create transaction writes them with the service (rollback test: a failing event insert leaves no service, no set row and no extras).
6. **The service section** on the service page (read: the set with necessity, the extras with their units; edit for the members: change the set, add and remove extras). Words in en and de; no role name in a message.
7. **The facet `kpi-set`** (`service.facet` with `labelsOf`: the set name, `emptyLabel` "no KPI set") through the shape of the ADR-0035 addendum; it appears in `GET /services/facets` and filters `GET /services`.
8. **Contributions to other modules' registries:** `service.usage`-style check (a set that a service uses cannot be deleted; the `registry.services` delete is not built, the check is ready), `org.usage` is not needed.
9. **v1 routes** (`r.public('v1', …)`, permission `kpi.framework.v1.read`, role `user` by default; contract tests from the harness, the walker stays green):
   - `GET /api/v1/categories`: **the legacy shape** (the names of the KPI sets) plus the additive fields `id`, `iri`, `description`, `rimoCategory` (the RIMO IRI or null), `indicators` count. Sorted by name then id.
   - `GET /api/v1/indicators?category=&service=`: **the legacy shape** (name, description, type, thematic category, `selected`, `necessity` per category) plus `id`, `iri`, `example`, `qualitative`, `unit` (`{key, symbol, iri}`), `min`, `max`, `measuredBy`, `canBeAutomatedBy`. **`totalCount` respects the filters** (defect 15; a regression test in `defect-15.v1-reads.test.ts`'s style). An unknown category or service is a 422 naming the parameter.
   - The v1 service row gains `category` (the KPI set's name) additively; `GET /api/v1/services?category=` filters by it. The diff job must show additions only.
10. **README, `docs/security/authorization.md` (the field tables of the two new v1 routes, as sprint 2 of M8 did), backlog, OpenAPI regeneration.**

ASVS impact (sprint 3): `docs/security/**` changes. **V8** gets a note and tagged evidence for the service-scoped permission: a member of another provider cannot change a service's KPIs (`[ASVS-8.2.1]`, `[ASVS-8.3.1]` style tags on the denial tests, never by editing an assertion); V6, V7 and V10 carry the `asvs-no-impact` line with a true reason. The maintainer fields stay the maintainer's.

Tests (sprint 3): the effective KPI set (the property tests above); every service method with a denied and a rollback case; the wizard journey (create a service with a set and an extra, then change the set and remove the extra on the page, both base paths); the facet; the v1 contract tests (empty page, last page, `pageSize` over the total, stable order, a token with and without the scope, `X-API-Key`, an unknown filter 422); `defect-14.service-kpis.test.ts` (an unknown set is 422, an extra is removable, the category change replaces the set in one transaction).

Definition of done: as sprint 2, plus `pnpm test:contract` and `pnpm openapi:diff` green (additions only).

## 8. Sprint 4: the RDF reads, journeys, ASVS and the release

**Branch:** `feature/m9-kpi-rdf-release`. **Goal:** the indicators can be read as RIMO-shaped RDF; the journeys, accessibility and security documents are complete; `0.11.0` is released.

Work items

1. **The RDF export** (`service/rdf.ts`, pure, no dependency): `toTurtle(model, options)` and `toJsonLd(model, options)` over one in-memory model built by one query function. It writes the ontology header (`@prefix rimo`, `skos`, `dct`, `uo`, `scorpion`), each indicator as `rimo:KPI` with `rimo:KPIName`, `rimo:KPIDescription`, `rimo:KPIExample` (when present), `rimo:isQualitativeIndicator`, one `rimo:hasValue` node typed `rimo:KPIValue` with `rimo:hasUnit` (the UO IRI where the term has one, otherwise our minted unit IRI), `rimo:measuredBy` and `rimo:canBeAutomatedBy` (minted IRIs typed `rimo:MeasurementMeans` and `rimo:AutomationTool`), and each KPI set as a `rimo:ServiceCategory` (the RIMO IRI when mapped) with `rimo:mandatoryFor`, `rimo:recommendedFor` and `rimo:appliedTo` pointing **from the indicator to the category**. The thematic category is a `scorpion:thematicCategory` literal (Decision 4). **Escaping** is a tested function for Turtle string literals and for IRIs (control characters, quotes, backslashes, `\u`, an IRI with a space or `>` is refused); the prototype's parser round-trips every fixture, including a hostile name. A snapshot test per format, and a test that the output equals the output of the previous run for the same data (stable order).
2. **The reads:** `GET /api/v1/kpi/rimo.ttl` and `GET /api/v1/kpi/rimo.jsonld` (a token with `kpi.framework.v1.read`, `Cache-Control: private, no-cache`; the walker and the contract tests cover them) and, Decision 9, the public counterparts `GET /public/kpi/rimo.ttl` and `.jsonld` for dereferencing the IRIs: definitions only, no value, no service, no person, `Cache-Control` with a short max-age and an ETag. The IRIs of §3 resolve to a small public HTML or Turtle page per object only if the maintainer later asks for it; they identify and do not dereference, and the README says so.
3. **The page of the API:** the landing page `/docs` lists the new routes; the reference shows the security scheme as for the other v1 routes (no change of the CSP).
4. **Journeys and accessibility:** `kpi-framework.spec.ts` (admin creates a unit-bearing indicator, builds a set mapped to a RIMO category, creates a service with that set, changes the set, reads `/api/v1/indicators` and `rimo.ttl` through the reference page with a token, under both base paths); axe in both themes on the indicator list, the set page, the wizard step and the service section; `shell.spec.ts` for the navigation.
5. **Gate and security documents:** `docs/security/authorization.md` (a short subsection on the RDF reads: what they expose, why a token or why public); V8 and V7 notes where the reads are public or token-bearing; `pnpm security:asvs --write`; the maintainer bumps `assessed_commit` before the release branch is cut.
6. **Backlog close-out with measurements:** the RDF size for the seeded indicators and for 200 indicators, the v1 `indicators` response time at 200 indicators, API calls added to the wizard and the service page (target: none on pages that already make four), the image size change. Entries for what did not fit (§11).
7. **Release `0.11.0`:** the release branch, `pnpm changeset version` (stop and ask if it does not announce `0.11.0`), `pnpm security:asvs --release`, the PR into `main`, the annotated tag `v0.11.0` (images `0.11.0-full`, `0.11.0-core-only`, `0.11.0-registry`), the merge-back into `dev`. Each outward step waits for the maintainer.

ASVS impact (sprint 4): the V8 and V7 files as item 5; V6 and V10 `asvs-no-impact`.

Tests (sprint 4): the RDF tests of item 1; contract tests of the two reads; the public reads' no-leak test (a service, a person, a value or a token never appears in the output, checked on a database full of them); the journey; axe.

Definition of done: `pnpm check`, the full `pnpm test`, `CI=true pnpm test:e2e`, `pnpm security:asvs` green on `dev` after the merge; the release tagged and its images in ghcr; `main` merged back; the backlog says what is true.

## 9. Acceptance (from implementation.md) mapped to tests

| Acceptance criterion                                                                                                                     | Where it is proved                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Tables `indicator`, `kpi_set`, `kpi_set_indicator` (necessity from the vocabulary), `service_extra_indicator`, `evaluation`              | the schema test (prefix, no enum), the service tests, `validateTerm` on save                                  |
| `kpi.valueType` registry: integer, float, text, duration, percentage; units; optional min/max                                            | the value-type table tests, the indicator service tests (bounds, qualitative rule), the `kpi.unit` vocabulary |
| Full CRUD for indicators and KPI sets, transactional, URL-safe identifiers                                                               | sprint 2 service and route tests, rollback cases, the slug rules, `defect-14.kpi-sets.test.ts`                |
| Contributes the `kpi-set` wizard step and the service-detail section                                                                     | the wizard and service-page tests, the journey, the fixture module test that exercises the `ui` export        |
| Effective KPI set is one tested query function; a category change replaces the set in one transaction; removing extras works (defect 14) | the property tests, `defect-14.service-kpis.test.ts`                                                          |
| v1 `categories` and `indicators` with a `totalCount` that respects filters                                                               | the contract tests, the walker, `pnpm openapi:diff` (additive)                                                |
| Indicators follow RIMO (new, Decision 2)                                                                                                 | the mapping tests of §3, the seed drift test, the RDF round-trip tests, the journey                           |
| Gate 2 (conditional)                                                                                                                     | ADR-0039, [m8-sprint-plan.md](m8-sprint-plan.md) §12                                                          |

## 10. Risks

| Risk                                                                                  | Effect                                                    | Mitigation                                                                                                                                                          |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RIMO is version 0.2.0 from a hackathon (treated as stable, Decision 15)               | the seed or the export drifts from the published ontology | a committed copy with its commit, a seed generated from it, an ADR for adopting a new version, the export names the version it follows                              |
| The hand-written Turtle and JSON-LD serialisers are wrong for some input              | invalid RDF, or an injection through a name               | the prototype with a real parser; one tested escaping function; round-trip tests with hostile names; no free text becomes an IRI                                    |
| The `ui` entry change and `showIf` reach into `registry.services` and `core.ui-shell` | sprint 3 grows                                            | the change is named in ADR-0040's addendum; if it exceeds the field config the sprint stops and says so; the wizard step can ship with a fixed set of widgets first |
| Seeded units carry IRIs and symbols in code, not in the vocabulary                    | an administrator's own unit has no IRI                    | stated in the README and the export (a minted IRI); term metadata is a backlog item                                                                                 |
| Migration (M13) must map the old categories and indicators onto the model             | M13 finds a gap                                           | a legacy type `number` maps to `integer`, `float` to `float`, `text` to `text`; the README of the module has the table; no data is lost by design                   |
| A shared table prefix or a clash with `kpi.ingestion`'s names                         | the loader refuses                                        | `kpif_` here and `kpii_` there (sprint 1 checks the loader's rule on the first run and changes the prefix if needed)                                                |
| 429s from a page that adds calls                                                      | the service page gets slower and limited                  | the section reads from the one `serviceKpis.get`; measured in sprint 4                                                                                              |

## 11. Out of scope (goes to `docs/backlog.md` if not there)

- Measurements, values per period, the `POST /api/v1/measurements`, adapters and reminders (M10); dashboards, scores and exports (M11); the impact tables (M12); the migration tool (M13).
- `rimo:requestedBy` (an indicator requested by an organisation or consortium); needs `registry.organisations` as a dependency.
- Importing a RIMO or any Turtle file at runtime (needs a parser as a runtime dependency).
- Metadata on vocabulary terms (IRI, symbol, description) in `core.settings`.
- Dereferenceable HTML pages per indicator , content negotiation on the v1 routes, SPARQL.
- Deleting a service (the `service.usage` check exists; the delete does not).
- A `kpi` profile image beyond `full`.

## 12. Additions to M9's scope in `implementation.md` (to approve with this plan)

- **Indicators follow RIMO** ([ADR-0040](adr/0040-indicators-follow-rimo.md)): fields `example`, `qualitative`, `unit`, `measuredBy`, `canBeAutomatedBy`; KPI sets map to `rimo:ServiceCategory`; minted IRIs; RIMO-shaped Turtle and JSON-LD reads.
- **The vocabularies** `kpi.unit`, `kpi.measured-by`, `kpi.automation-tool`, `kpi.service-category`.
- **A fourth `ui` export for wizard extensions** and a serialisable `showIf` (closes two backlog items of M7).
- **Gate 2 is conditionally passed** (ADR-0039).

## 13. Decisions

Answered by the maintainer on 2026-10-14:

1. **Gate 2 is conditionally passed** until the staging dry run of M13 (like ADR-0031): an ADR records it, M9 may start, a gap found at the dry run is fixed in the milestone then running.
2. **A KPI set stays a free, administrator-named set;** it optionally names a RIMO service category (the 16 terms are seeded). A fixed list of 16 was rejected because instances differ; a one-to-one replacement was rejected because the old data has other sets. **RIMO parts in M9:** name, description, example, qualitative, unit, `measuredBy`, `canBeAutomatedBy`, and the legacy thematic category. `requestedBy` is not in M9.
3. **Units are a vocabulary** (`kpi.unit`), seeded with Units Ontology IRIs and symbols for the seeded terms; no free-text unit.
4. **The thematic category stays** (it is not in RIMO): the legacy vocabulary, exported as `scorpion:thematicCategory`.
5. **IRIs are stable and minted from settings; JSON-LD and Turtle are read through the API; the seed comes from `RIMO.ttl`.** The base is `kpi.iriBase`.
6. **The link of a service to its KPI set lives in this module's own tables** (`kpif_service_set`, `kpif_service_extra_indicator`), not in `svc_field_value`.
7. **The v1 `categories` and `indicators` keep the legacy shape and add fields;** a RIMO-first shape would be v2.
8. **M9 has four sprints.**

Approved by the maintainer on 2026-10-14 (the proposals of the draft):

9. **The seed extractor is our own small script, with no parser dependency** (the file is regular; the script fails on an unknown shape).
10. **The RDF reads are token-bearing in v1 and public as a second pair of routes** (definitions only, no values); IRIs identify and do not dereference to a page.
11. **A qualitative indicator must have the value type `text`;** a `text` indicator may be qualitative or not.
12. **`rimo:hasUnit` goes on a `rimo:KPIValue` node per indicator** (its domain in RIMO), which M10's real values will reuse.
13. **No `kpi` profile image in M9** (the `full` profile carries the module); a profile that selects the KPI modules without the rest is decided when M10 needs it.
14. **The table prefix is `kpif_`** (sprint 1 checks it against the loader's rule on the first run and changes it only if the loader refuses).
15. **RIMO 0.2.0 is treated as stable** (the maintainer, 2026-10-14). The risk of a changed or vanished ontology stays in §10 as a note; the committed copy, the seed and ADR-0040 remain the way a later version is adopted.
