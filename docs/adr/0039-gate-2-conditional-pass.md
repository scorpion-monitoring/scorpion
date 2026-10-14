# ADR-0039: Gate 2 passes conditionally while the staging dry run waits for M13

- Status: Accepted
- Date: 2026-10-14

## Context

Gate 2 ([implementation.md](../implementation.md) §4) has four lines. Three are met by evidence that CI produces: the `registry` profile
image builds and starts, the catalogue, wizard and edit flows pass the end-to-end tests, and the v1 contract tests pass. The evidence,
taken at release `0.10.0` (tag `v0.10.0`), is in [m8-sprint-plan.md](../m8-sprint-plan.md) §12.

The fourth line reads "the profile runs on staging with real organisation and service data from a partial migration dry run". It needs
the migration tool (`tools/migrate-legacy`, M13) and the maintainer's staging instance with a copy of the old data. Neither exists yet,
and M9 (`kpi.framework`) has no technical dependency on it. Waiting would stop the KPI work for no technical reason; ADR-0031 settled the
same situation for Gate 1.

## Decision

1. Gate 2 is **conditionally passed on 2026-10-14**: every line holds except the staging dry run with real data.
2. M9 may start. It adds a module to the `full` profile only; the `registry` and `core-only` profiles and their images do not change.
3. The dry run is the maintainer's check and is **due at M13**, when the migration tool can import a partial copy of the old database.
   Gate 2 is **cleared** when that run has been done and its result is recorded in the plan of M13.
4. If the dry run finds a gap in the registry modules (organisations, services, the public API), the fix goes into the milestone then in
   progress, with a regression test, and the gate stays open until the fix is merged.

## Consequences

- No claim changes. The gate's status line in `implementation.md` says "conditionally passed" and names this ADR.
- The mapping of the old categories and indicators onto `kpi.framework` (M9) is part of the same dry run; the module README holds the
  table of legacy types ([m9-sprint-plan.md](../m9-sprint-plan.md) §10).
- The risk is that real data exposes a model gap late. It is accepted: the model of M6 to M8 was built from FEATURES.md, whose data
  shapes come from the old database, and the migration tool is the first thing that can test it against the data itself.
