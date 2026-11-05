# kpi.impact

The impact figures of a consortium for Reviewers and Admin: how many services it has, how many are open source, how many are in each stage, and the yearly table of one headline KPI per service. **Defect 9**
of [FEATURES.md](../../docs/FEATURES.md) §5 is what it must not repeat (a stage that was counted but not in the enum, and stage labels that differed between
screens). The decisions are in [ADR-0048](../../docs/adr/0048-impact-read-model.md), the plan in [m12-sprint-plan.md](../../docs/m12-sprint-plan.md).

Status: **M12 sprint 2** (`0.15.0` when the milestone releases): the module, the tiles, the yearly table computed live, and three internal routes. Nothing is on screen yet; there is **no stored model** (sprint 3 was dropped on 2026-11-05, ADR-0048); the page (sprint 4) follows. The module is in the `full` profile only.

## Manifest

| Part                               | Value                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id                                 | `kpi.impact` (package `@scorpion/kpi-impact`)                                                                                                                                                                                                                                                                                                                                                               |
| tables                             | **none**, and so no table prefix; the stored model was dropped (ADR-0048)                                                                                                                                                                                                                                                                                                                                   |
| dependencies                       | `core.authz`, `core.settings` (the vocabularies `stage` and `aggregate`), `registry.organisations` (the consortia), `registry.services` (the rows and the licence facts), `kpi.framework` (the evaluation and the value types), `kpi.ingestion` (the series read) and `kpi.analytics` (the registry `analytics.aggregate` and the calculation library). The optional peer `core.ui-shell` joins in sprint 4 |
| routes                             | internal: `GET /kpi/impact/consortia`, `GET /kpi/impact/summary`, `GET /kpi/impact/table`; never public v1                                                                                                                                                                                                                                                                                                  |
| permissions                        | the plain `kpi.impact.read`, held by the role `reviewer` and by Admin, **not** by `user`                                                                                                                                                                                                                                                                                                                    |
| events, jobs, settings, registries | none                                                                                                                                                                                                                                                                                                                                                                                                        |
| demo data                          | none: the module owns no data, so there is no `demoSeed` (ADR-0046)                                                                                                                                                                                                                                                                                                                                         |

## The tiles

`GET /kpi/impact/summary?consortium=<id>[&includeUnpublished=true][&locale=de]` counts **live** on every request (`Cache-Control: no-store`):

| Field                                     | Meaning                                                                                                                                                                    |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `total`                                   | the services counted: the **published** ones of the consortium, or every linked one with `includeUnpublished=true` (decision 16)                                           |
| `openSource`                              | the licence is an **OSI-approved, not deprecated** SPDX id (decision 19)                                                                                                   |
| `licenceDeprecated`                       | a deprecated SPDX id, OSI-approved or not: **not** open source                                                                                                             |
| `licenceUnknown`                          | no licence, or an id the SPDX list does not know: not open source                                                                                                          |
| `otherLicence`                            | a current licence that is not OSI-approved. The four counts add up to `total`                                                                                              |
| `stages: [{ key, label, active, count }]` | **one line per term of the vocabulary `stage`**, active or deactivated, in the vocabulary's order, zero counts too; `label` is the vocabulary's in `locale` (default `en`) |
| `otherStages: [{ key, count }]`           | a stage key services hold and the vocabulary does not list: shown by its key, never dropped                                                                                |

A service is counted **once** in each consortium it is linked to (role `consortium`) and in none when it has no link. A `consortium` that is no id, names no
organisation or names one that is not a consortium is a **422 naming `consortium`**; a consortium of more than 2,000 services is one too, never a silent cut.
`GET /kpi/impact/consortia` lists `{ id, name, abbreviation }` of the organisations of type `consortium` in the list envelope.

The licence verdict comes from the same SPDX adapter (24 h cache, bundled fallback) as the licence field of a service, through `registry.services`'s
`findLicencesAsSystem`; the live fetch is never used in a test.

## The yearly table

`GET /kpi/impact/table?consortium=<id>&year=<year>[&includeUnpublished=true][&page=0][&pageSize=50][&locale=de]` answers the list envelope (`metadata`,
`result`) plus `year` and `years` (the years offered: the current year and the nine before it, newest first), `Cache-Control: no-store`. It is **computed live**
from the evaluation and the measurements; sprint 3 may store the same figures, and these are the numbers the stored model must reproduce. A page is a page of
services (default 50, at most 200) by name without case, then id; `totalCount` counts every service the filter keeps. A `consortium` that is no consortium and a
`year` outside the years offered are a 422 naming the parameter; a consortium with no services is an empty list.

Each row has `serviceId`, `name`, `slug`, `state`, `reason`, `advice`, `headline` (`indicatorId`, `name`, `unit`, `aggregate`, `label`), `months` (twelve entries,
January first), `yearly` and `monthsWithValue`. The state is one of four, exclusive, and each says in words what to do (`advice`, with a stable `reason` code a
page can translate); none is a blank:

| State           | When                                                                                                                                                                          | `reason`                                                                                         |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `ok`            | the headline has a value in at least one month of the year                                                                                                                    | `ok`                                                                                             |
| `no-data`       | the service has a headline and no value in the year                                                                                                                           | `no-values`                                                                                      |
| `no-evaluation` | the service has no KPI set, or its set has no headline (an administrator removed the headline's indicator from the set, which removes the evaluation with it)                 | `no-set`, `no-headline`                                                                          |
| `error`         | the headline cannot be read: its value type is text (not numeric), unknown, does not allow the aggregate, or the aggregate has no function; or the read of one service failed | `not-numeric`, `value-type-unknown`, `aggregate-not-allowed`, `aggregate-unknown`, `read-failed` |

An `error` of one service never fails the page; the text of an exception is logged and never shown.

- **The current evaluation applies to every year** (decision 17 of the plan): a service whose KPI set or headline changed during the year, or since, is read with
  today's headline for all twelve months. The values of a KPI the service has since dropped are read like any other (the series read does not look at the set).
  A page says "with today's headline"; a history of evaluations is the backlog.
- **A gap is a gap.** A month with no value is `null`, never zero; `yearly` is the aggregate over the months that have a value and `monthsWithValue` says how
  many ("n of 12"), so a sum of nine months is not read as a year. A zero reported is a value. A duration is in seconds, as stored.
- The aggregate function comes from the registry `analytics.aggregate` of `kpi.analytics` by the id of the evaluation, and the arithmetic is that module's
  calculation library (`service/year.ts` does none of its own); `headline.label` is the vocabulary's label of the aggregate in `locale`. The twelve months are
  the month ends of the year (`monthEnd`, so 29 February in a leap year); a value of 31 December is in its year and one of 31 January in the next.
- **Cost:** one series read per service (the indicator's description and the values: two statements) and one read of the evaluation; never one per month.
  Rows are computed eight at a time. The measurements are in [docs/backlog.md](../../docs/backlog.md) and [ADR-0048](../../docs/adr/0048-impact-read-model.md).

## Who may read

The plain `kpi.impact.read` on the route and again in the service, **before** the consortium is looked at. 401 anonymous, 403 for `user`, 200 for a Reviewer and
Admin. The summary holds counts, labels and consortium names; the table holds service names and slugs, the headline's name and unit and the values, and no person, run, source or file name. See [docs/security/authorization.md](../../docs/security/authorization.md).

## The reads it uses

`registry.organisations.listConsortiaAsSystem()`, `registry.services.listImpactRowsAsSystem(consortiumId)` and `registry.services.findLicencesAsSystem(ids)`,
`kpi.framework.evaluationOfServiceAsSystem(serviceId)` and `findValueType(id)` (`servicesOfSetAsSystem(setId)` is there for the refresh of sprint 3),
`kpi.ingestion`'s `reads.seriesAsSystem`, the registry `analytics.aggregate` and the calculation library of `kpi.analytics`, and `core.settings`'s
`listTerms('stage' | 'aggregate', { includeInactive: true, locale })`. The module reads no other module's table.

## Tests

`service/tiles.test.ts`, `service/year.test.ts` (pure, table-driven, with `fast-check` properties), `service/rows.test.ts` (the states with faked reads),
`service/table.test.ts` (real Postgres: every state, the year boundary, order, paging, the 422s, the denied callers), `service/impact.test.ts` (real Postgres: denied per caller class, the consortium check, two consortia, the
published switch, the licence verdicts through the stub SPDX), `defect-09.stage-labels.test.ts` (never weaken it), `module.test.ts`, and
`apps/server/src/impact-routes.test.ts` (the routes through the pipeline). The trusted reads are tested in their owning modules.
