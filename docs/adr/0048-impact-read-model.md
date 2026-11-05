# ADR-0048: `kpi.impact`: live tiles, a yearly table (computed live; the stored model dropped), plain tables instead of views

- Status: Accepted; **the stored model (decisions 1 and 2, sprint 3) was dropped on 2026-11-05, see "Amended: the model is dropped"** (decisions 15 to 21 answered by the maintainer on 2026-10-22; plan: [m12-sprint-plan.md](../m12-sprint-plan.md))
- Date: 2026-11-04

## Context

M12 rebuilds the impact evaluation (FEATURES §3.9): for one consortium, the number of its services, how many are open source, the number per stage, and a
yearly table of one headline KPI per service. Defect 9 (§5) is its test: the legacy page counted `TERM` although its enum lacked it, and the stage labels
differed between screens. The architecture lists `kpi.impact` with "none (read model)" for tables and "materialised yearly and monthly aggregates per
consortium, refreshed on events". The module is new, in the `full` profile only, adds no runtime dependency and no public v1 route.

## Decision

1. **Plain tables, not materialised views** (decision 15). The read model of the yearly table (sprint 3) is plain `kpi_impact_` tables written by a tested
   service function in one transaction. A materialised view is refreshed whole; one measurement of one service must not recompute every consortium, and CLAUDE.md
   asks for tested query functions or refreshed read models, not correctness-critical SQL views. This deviates from the wording of the architecture. Sprint 1
   writes no table.
2. **Live tiles, a stored table.** Counts of services (total, open source, per stage) are queried on every request, so they follow a stage change at once; only
   the monthly and yearly figures are stored.
3. **Published services only by default, a switch for the rest** (decision 16). Both routes take `includeUnpublished` (default `false`); the model is per
   service and independent of publication.
4. **The current evaluation applies to every year shown** (decision 17); a history of evaluations is the backlog.
5. **A yearly aggregate is over the months that have a value, and says how many** (decision 18): nine months of a `sum` are "9 of 12 months"; a gap is `null`,
   never zero.
6. **Open source means an OSI-approved, not deprecated, SPDX id** (decision 19). A deprecated id is counted as `licenceDeprecated` (not open source), an id the
   list does not know or no licence as `licenceUnknown`, and a current licence that is not OSI-approved as `otherLicence`, so the four counts add up to `total`.
7. **The permission is the plain `kpi.impact.read`** (decision 20), held by `reviewer` and Admin, not by `user`, no scoped variant. It is checked on the route
   and again in the service, before the consortium is looked at. An instance may give it to another role.
8. **Four sprints** (decision 21): tiles, live table, model, page and release (`0.15.0`).
9. **Stage lines come from the vocabulary** (defect 9): one line per term of `stage`, deactivated terms included, labelled in the caller's language, zero counts
   listed, and `otherStages` for a key the vocabulary does not list. The module holds no stage literal and no pg enum; a source test checks it.
10. **Additive trusted reads, not table access.** `registry.services` gains `listImpactRowsAsSystem(consortiumId)` (minimal rows, at most 2,000, a larger
    consortium is a 422 naming `consortium`) and `findLicencesAsSystem(ids)` (SPDX facts through the adapter the licence field uses); `registry.organisations`
    gains `listConsortiaAsSystem()` (at most 500). None changes public v1.

## Consequences

- The tiles cost three reads per request (the rows, the vocabulary terms, the licence facts); the 2,000-row bound keeps that small.
- The summary leaves out `licencesAsOf`: the `Spdx` adapter does not say when its list was fetched (backlog).
- Sprint 3 may drop the stored table if sprint 2's measurement shows the live table is trivially fast; the decision stays reversible without a migration until then.
- `docs/security/authorization.md` gains the route rows and the field table of the summary; ASVS V8 carries the evidence.

## Amended in sprint 2: the table computed live, and what it costs

- **The table is computed live first** (`GET /kpi/impact/table`, `service/rows.ts`, `service/year.ts`): one read of the evaluation (`kpi.framework`'s new trusted
  `evaluationOfServiceAsSystem`, which returns the set and its headline, `null` for a service with no set) and **one `seriesAsSystem` call** for the twelve months of
  a year, per service. The yearly figure is the aggregate of the registry `analytics.aggregate` over the months that have a value, with the count ("n of 12"); the
  arithmetic is the calculation library of `kpi.analytics`. The current evaluation applies to every year. A row is in one of four exclusive states and says in words
  what to do; an `error` of one service never fails the page. `kpi.framework`, `kpi.ingestion` and `kpi.analytics` become dependencies of the module.
- **A removed headline indicator is `no-evaluation`, not `error`.** The key of the evaluation refuses an indicator outside the set and `sets.setIndicators` removes the
  evaluation with it, so the case the plan listed under `error` reads as "the set has no headline".
- **Measured** (local Postgres in Testcontainers, a warm run, the median of five; the details and the method are in [docs/backlog.md](../backlog.md), "`kpi.impact`
  follow-ups (M12 sprint 2)"): a page of 50 services takes 138 ms at 50 services in the consortium and 222 ms at 1,000; a page of 200 takes 157 ms at 50 services,
  480 ms at 200 and 511 ms at 1,000; the statements are 4 per service with a headline and none per month (189 for a page of 50, 744 for a page of 200). The cost is the
  page, not the consortium, because the page is cut before the rows are computed.
- **Consequence for sprint 3 (a recommendation; the maintainer decides).** The stored model is not needed as a speed-up, and a stored table can only be as right as the
  live one, at the price of two handlers, a nightly job and a repair. Recommended: do not build it for now; if a page of 200 must be faster, add the two batched trusted
  reads named in the backlog. Decision 1 above (plain tables instead of views) stays as the form the model would take; dropping the model needs this ADR to say so.

## Amended: the model is dropped (2026-11-05)

- **Decision.** The maintainer accepted the recommendation of sprint 2: **no stored model.** The yearly table is computed live on every request (`service/rows.ts`, `service/year.ts`), as are the tiles. The module owns **no table, no job, no setting and no event handler**; it needs no table prefix, no migration and no `demoSeed`. The `figuresAsOf` field of the plan does not exist.
- **Why.** A page of 50 services takes 140 to 220 ms and a page of 200 about 0.5 s whatever the size of the consortium (4 statements per service, none per month); a stored table could only be as right as the live one and adds two handlers, a nightly job and a repair, with the risk that it disagrees with its inputs (the legacy view's failure, defect 9's cousin).
- **What this changes above.** Decision 1 (plain tables instead of views) now applies only if a model is ever built; decision 2 reads "live tiles and a live table". The architecture's "materialised yearly and monthly aggregates … refreshed on events" and the nightly refresh are **not implemented**; `implementation.md` says so.
- **Reversible.** If a page of 200 must be faster, first add the batched trusted reads (`kpi.ingestion`, `kpi.framework`; backlog); a stored model comes only after that, with a new ADR that supersedes this paragraph.
