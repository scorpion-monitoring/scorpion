# kpi.impact

The impact figures of a consortium for Reviewers and Admin: how many services it has, how many are open source, how many are in each stage, and the yearly table of one headline KPI per service. **Defect 9**
of [FEATURES.md](../../docs/FEATURES.md) §5 is what it must not repeat (a stage that was counted but not in the enum, and stage labels that differed between
screens). The decisions are in [ADR-0048](../../docs/adr/0048-impact-read-model.md), the plan in [m12-sprint-plan.md](../../docs/m12-sprint-plan.md).

Status: **M12 sprint 4** (`0.15.0` when the milestone releases): the module, the tiles, the yearly table computed live, three internal routes and **the page** at `/services/evaluate`. There is **no stored model** (sprint 3 was dropped on 2026-11-05, ADR-0048). The module is in the `full` profile only.

## Manifest

| Part                               | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id                                 | `kpi.impact` (package `@scorpion/kpi-impact`)                                                                                                                                                                                                                                                                                                                                                                                                                       |
| tables                             | **none**, and so no table prefix; the stored model was dropped (ADR-0048)                                                                                                                                                                                                                                                                                                                                                                                           |
| dependencies                       | `core.authz`, `core.settings` (the vocabularies `stage` and `aggregate`), `registry.organisations` (the consortia), `registry.services` (the rows and the licence facts), `kpi.framework` (the evaluation and the value types), `kpi.ingestion` (the series read) and `kpi.analytics` (the registry `analytics.aggregate` and the calculation library). The optional peer `core.ui-shell` (as for `kpi.ingestion`): a profile without it has the routes and no page |
| pages                              | `ui.routes` `/services/evaluate` with the permission `kpi.impact.read`, and a `ui.nav` entry "Impact" (id `services.impact`, section `main`, order 22, icon `chart`) with the same permission; the page is `ui/Evaluate.svelte`, its texts are in `ui/messages.ts` (en, de)                                                                                                                                                                                         |
| routes                             | internal: `GET /kpi/impact/consortia`, `GET /kpi/impact/summary`, `GET /kpi/impact/table`; never public v1                                                                                                                                                                                                                                                                                                                                                          |
| permissions                        | the plain `kpi.impact.read`, held by the role `reviewer` and by Admin, **not** by `user`                                                                                                                                                                                                                                                                                                                                                                            |
| events, jobs, settings, registries | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| demo data                          | none: the module owns no data, so there is no `demoSeed` (ADR-0046)                                                                                                                                                                                                                                                                                                                                                                                                 |

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
January first), `yearly`, `monthsWithValue` and `shown` (`months` and `yearly` as text, see "The page"). The state is one of four, exclusive, and each says in words what to do (`advice`, with a stable `reason` code a
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

## The page

`/services/evaluate` (the path of the legacy page; `ui/Evaluate.svelte`, registered through `ui.routes`, never a SvelteKit file route) is for holders of `kpi.impact.read`: the shell
refuses it (403) and leaves the entry "Impact" out of the navigation for everybody else. It reads in three places and counts them:

| What a person does                                                 | Reads the browser sends                                                         |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| opens the page (the loader reads on the server)                    | none: the consortia and the words of the unit vocabulary are read by the loader |
| opens a link that names a consortium (`?consortium=…`)             | the summary and the table (two)                                                 |
| chooses a consortium, or flips the switch for unpublished services | the summary and the table (two)                                                 |
| changes the year, the page or the page size                        | the table (one)                                                                 |

The address keeps the choices (`?consortium=&year=&unpublished=1&page=`), so a link opens the same view. The figures are **computed when the page is opened** and each time a choice changes;
every year is read **with today's headline** (decision 17). The page says which set the figures are for ("published services only" or "all services of the consortium"); the switch is
the `includeUnpublished` of decision 16. It shows:

- **The tiles**: the total; the four licence lines (open source, other licence, deprecated licence, licence unknown), which add up to the total; one line for every term of the vocabulary `stage`
  (a deactivated one says so, a stage nobody holds shows 0) and a line for a stage key the vocabulary lacks, which add up to the total too. Each line says what it means, and the stage counts are
  also written as a sentence. The stage label is the vocabulary's own (defect 9).
- **The table**: a real `<table>` with a caption, `<th scope="col">` and `<th scope="row">` (the service name, linking to its page), the state **in words and an icon**
  (never colour alone) with the sentence of its `reason` code in the person's language, the headline's name and unit, the twelve months, and the yearly figure with "n of 12 months" and
  the aggregate's label. A month without a value, a headline-less service and a service without a yearly figure each say so; no cell is blank. A figure is written by the `shown` field of the
  row (see below). The table is in a keyboard-reachable scroll region, the focus stays on the control that changed, and a polite live region says "Table of 2025 for <consortium>: N services".
- **No chart** (a sparkline per service is in the backlog) and no motion.

**Figures for reading.** The table row carries `shown` next to the numbers: `months` and `yearly` as text in the requested `locale`, written by the value type of the headline. A value type may
offer `display(value, locale)` (an optional member of the `kpi.valueType` registry entry; the duration has one, `HH:MM:SS`, rounded to the second); without it a number is written in the language with
at most two decimals. The numbers stay the data (a duration is seconds).

**Words.** `ui/messages.ts` has every text in English and German; `ui/ui.test.ts` runs the catalogue check of `@scorpion/ui-kit` (`catalogueProblems`) and fails for a missing key, a changed
placeholder, a reason code of `rows.ts` without a sentence in either language, or a source that uses `{@html}`, a hand-written request, motion or a stage key. No text names the instance. The labels
of the `aggregate` terms in German (`Summe`, `Durchschnitt`, `Minimum`, `Maximum`) are **seeded by `core.settings`** for a new instance; terms of a database that exists are never overwritten, so
there the page shows the English label until an administrator adds the German one in the vocabulary editor (the label falls back visibly, it is never missing).

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
`service/table.test.ts` (real Postgres: every state, the year boundary, order, paging, the 422s, the denied callers, the figures written for reading), `service/impact.test.ts` (real Postgres: denied per caller class, the consortium check, two consortia, the
published switch, the licence verdicts through the stub SPDX), `defect-09.stage-labels.test.ts` (never weaken it), `module.test.ts`, and
`apps/server/src/impact-routes.test.ts` (the routes through the pipeline), `ui/ui.test.ts` (the page: the two halves agree, the catalogue, the reason sentences, the address, the source rules) and the end-to-end journey
`apps/web/e2e/impact.spec.ts` under both base paths (the counts, the year, the states in words, the switch, a reported measurement after a reload, access for a plain User and an anonymous visitor, the keyboard, German,
`[impact-calls]` and axe in both themes). The trusted reads are tested in their owning modules.
