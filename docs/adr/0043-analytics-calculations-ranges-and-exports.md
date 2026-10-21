# ADR-0043: the calculation library and what undefined means, the ranges, text values, and the exporters' table

- Status: Accepted
- Date: 2026-10-21

## Context

M11 builds `kpi.analytics` on the dashboard of [ADR-0042](0042-dashboard-document-and-grid.md) ([m11-sprint-plan.md](../m11-sprint-plan.md), decisions 10 to 13). This ADR records the
decisions of its first sprint (the calculations and the reads) and, for sprint 5, the table an exporter writes. It is amended, as the plan is, under "Amended in sprint N".

**The deviation from the architecture.** The `kpi.analytics` row of [architecture.md](../architecture.md) lists a table `dashboard_preference`. **The module has no table** and no table
prefix: the dashboard document is a preference of `core.settings` (ADR-0042 Decision 1), and the defaults of a person are a second preference key, `kpi.analytics.defaults`. A person's
defaults are one small JSON value per person, which is what `settings_user_preference` already is, with its size cap and its own-data-only rule. A table becomes the way out only if
sharing or the size cap asks for it (backlog).

## Decision

### 5. The calculation library, and what "undefined" means

All calculations are **pure functions in `modules/kpi-analytics/service/calc/`** (no database, no clock, no registry), reached through `public.ts`. A series is `(number | null)[]`, oldest month first.

- Every function takes numbers and returns **a number or `null`**. None throws, none returns `NaN` or an infinity (an overflow is `null`), and **none turns a gap into a zero**: a gap is skipped, and `null` in a result
  means "not defined", which the page shows as "n/a". Anything that is not a finite number in an input is treated as a gap.
- **Change %** is `(newest - oldest) / abs(oldest) * 100` over the first and the last month that have a value: undefined with fewer than two values or when the oldest is 0. The absolute value keeps the sign meaning
  "up" and "down" for negative values.
- **`sum`, `avg`, `min`, `max`** are the four functions the terms of the vocabulary `aggregate` map to, through the registry `analytics.aggregate` (the terms are data of `core.settings`, the functions are code; the module
  holds no list of terms beyond the four). `avg` is held between `min` and `max`, so rounding cannot leave the range.
- **Cumulative** keeps one entry per month; a gap stays `null` and the total carries across it (a gap adds nothing).
- **MAPE keeps the legacy meaning**: the mean absolute percentage deviation from the mean, `mean(abs(v - mean)) / abs(mean)`, as a fraction. Undefined with fewer than two values or a mean of 0; **a constant series is exactly 0**
  (not a rounding error near it). Its **bands** come from two module settings, `volatility.thresholds.low` (0.4) and `.high` (0.8): below `low` is `low`, up to but not including `high` is `medium`, from `high` is `high`.
  The settings are validated by the module's schema (`0 < low < high <= 5`) and **an out-of-range value is refused, never clamped**.
- The registry **`analytics.score`** carries scores of a series (`volatility`); another module adds one by contributing an entry. Entries of both registries are validated by a Zod schema at start and **two with one id stop the start**.
- **Month ends** use the Gregorian rule of `kpi.ingestion` (`daysInMonth`: 1900 was no leap year, 2000 and 2024 were). **A duration** is seconds, as the value type stores it; the library converts parts to seconds and back.

### 6. Ranges, and where a window starts

The ranges are `3m`, `6m`, `1y`, `2y` and `all`. A window is **counted back from the current month by the injected clock** (UTC), the current month being its last month, so the window is the same for every KPI of a
service and for every widget (the alternative, counting from the latest month with a value, would give each KPI a window of its own). The current month is therefore usually a gap until it is reported.

- **A range is always applied.** The legacy page took "no duration" to mean "no date filter" (defect 10). Here a **missing range is repaired to `1y`** and applied, a **range that is not one is a 422 naming `range`**, and **`all` is a
  value**, chosen explicitly. `all` is the most months one read serves, **120**, which is the bound of the trusted series read; a service with older data than that needs a feature, not a wider window (backlog).
- The window is an explicit list of months, so a KPI with a gap shows a gap and a window that starts in the middle of a series does not see the months before it.
- The thematic filter reads the vocabulary `thematic-category` **in one place**, which the reads and the defaults both use: a term added to the vocabulary is offered, and accepted, by both at once; a deactivated one is
  refused by both (`defect-10.dashboard-filters.test.ts`). `all` or no category means every category, and a term with the key `all` would be shadowed by it.

### 7. Text values are shown as text, and a default service is deterministic or none

- A **text value is never parsed to a number**. The legacy page took the first number in the string; that is a defect. A point is `value` (a number) **or** `text` (a text value) **or** neither (a gap). A figure of a text KPI (change,
  average, volatility) is undefined.
- A person's defaults (`kpi.analytics.defaults`: `{ service?, range, category }`) seed the configuration of a new widget. **The stored value is never trusted**: a pure `parseDefaults` repairs it and never throws (a
  `fast-check` property): a bad service is dropped, a missing or unknown range becomes `1y`, an unknown category becomes `all`. With no default service the new widget takes **the first service of the person's
  providers by name** (the picker's order, name without case then id), **else none**, and shows "Choose a service". The legacy page took an arbitrary first service. A person with no tie to a provider gets none, however many
  services the instance has.
- The reads are open to **every holder of the plain permission for every service** (decision 13 of the plan, as the measurements are); never anonymous, never public v1.

### 8. The exporters' table and the escaping (sprint 5)

Recorded now so that sprint 5 builds on it; nothing of it is built in sprint 3. An exporter (registry `analytics.exporter`, `{ id, labels, extension, mediaType, write(table) }`) writes **one table**: one row per KPI (name, unit,
then **one column per month of the union of the months of all the series** in the window, empty where a KPI has no value). The legacy export assumed every KPI shared the first KPI's dates and so misplaced values. Every cell is
escaped with `escapeCell` of `kpi.ingestion` (a cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage return is neutralised), the CSV is UTF-8 with a BOM like the import templates, the file name comes from the service's
abbreviation and never from free text, and no instance name or contact appears in the file unless the settings carry it.

## What the source forced (the plan said otherwise, or said nothing)

1. **The trusted reads of `kpi.framework` did not carry the thematic category** of an indicator, which the filter needs. `effectiveIndicatorsAsSystem` and `indicatorsByIdAsSystem` gained `thematic` (additive, tested in
   `service/trusted.test.ts`), so `kpi.analytics` does not read `kpif_indicator`.
2. **The trusted series read of the plan, `seriesAsSystem(serviceId, indicatorIds, from, to)`, cannot find a dropped KPI**: it takes the ids. `kpi.ingestion` gained a companion,
   `measuredIndicatorsAsSystem(serviceId, from, to)`: the ids of the indicators with a value in the window (sorted, at most 200). `kpisInPeriod` was the alternative and was rejected: it answers per month (up to 120 queries), and its rows
   are the set rows as they are now, so it would miss a KPI removed from a set. Both reads are trusted (no permission, no route) and bounded to 120 months and 200 indicators.
3. **`GET /kpi/analytics/*` take the service as an id and answer 422 for one that does not exist**, as the plan says; the grid route of `kpi.ingestion` answers 404 for the same case. The plan's rule is followed.
4. The architecture's `kpi.analytics` row also lists a job; none is needed (the reads compute on request), so the module has no job.
5. The server's test helper (`apps/server/src/testing/identity-app.ts`) gained an `analytics` option, and the module's harness is on the list of files that may import module manifests (`eslint.config.js`), as the
   other harnesses are.

## Consequences

- The numbers on a dashboard come from one library with one meaning of "undefined", tested with tables and properties; a widget never calculates.
- Defect 10 has a regression test that fails if a window can be left open, if the category lists can differ or if a service is chosen for a person.
- A series of 120 months of 200 KPIs is the largest answer (a page holds at most 200 KPIs; the default page is 50). Sprint 4 counts the calls and shares reads between widgets; the time of both reads at 50 000
  measurements is in the backlog.
- `kpi.ingestion` and `kpi.framework` each gained additive trusted reads; no public v1 route changed (`pnpm openapi:diff` is clean).
- The run-time image no longer carries the packages only the browser needs (ECharts, Svelte, the grid): step 5 of `docker/Dockerfile` selects the server's closure with `--filter-prod`. The sizes are in the backlog.
