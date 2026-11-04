# ADR-0048: `kpi.impact`: live tiles, a stored yearly table, plain tables instead of views

- Status: Accepted (decisions 15 to 21 answered by the maintainer on 2026-10-22; plan: [m12-sprint-plan.md](../m12-sprint-plan.md))
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
