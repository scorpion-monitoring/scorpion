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

Recorded in sprint 3 and built in sprint 5 (see "Amended in sprint 5" below). An exporter (registry `analytics.exporter`, `{ id, labels, extension, mediaType, write(table) }`) writes **one table**: one row per KPI (name, unit,
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

## Amended in sprint 5

The exporters are built as Decision 8 says. What the source added or decided:

1. **The route has its own permission.** `GET /kpi/analytics/export` needs `kpi.analytics.export` (plain, role `user`, also Admin), not `kpi.analytics.read`: exporting a file is a different act from reading a page, so an instance can withdraw one and keep the other. The route is audited and in the default rate bucket; the service checks the permission again **before** it validates anything, so a caller without it learns nothing about formats, services or categories (decision 13 of the plan: every holder, every service, never anonymous).
2. **The format is a key of the registry, not a Zod enum.** `format` is a string of at most 32 characters; the service looks it up in `analytics.exporter` and answers 422 naming `format` when there is none, so a module that contributes an exporter needs no change to the route. The registry entry is `{ id, labels, extension, mediaType, write(table) }`; `write` returns the bytes at once (a PDF, which needs a job, is in the backlog).
3. **A number is not escaped.** `escapeCell` is applied to text only (headings, names, units, text values). A negative number stays a number, so that the file parses back to the numbers of the series; Excel reads `-5` as a number, not a formula.
4. **The file name is the slug of the service.** The plan says "abbreviation"; the legacy v1 field `abbreviation` of a service **is** its slug (`registry.services` maps `abbreviation: row.slug`), so the name is the slug reduced to `a-z0-9-`, then `-kpis-<range>.<extension>`. `range` is one of five fixed words, so no free text reaches the header.
5. **The unit is written as its label** (the term of the vocabulary `kpi.unit`), the key where there is none. The month columns are `YYYY-MM`, written as text in the XLSX (format `@`) so that no spreadsheet turns them into dates.
6. **One dependency, no new package.** `write-excel-file` is declared by `kpi.analytics` at the exact version `kpi.ingestion` pins (4.1.1); `read-excel-file` (9.3.12, as in `kpi.ingestion`) is a dev dependency of `kpi.analytics` and `apps/server` for the tests. The lockfile gains only the importer entries.

## Amended in sprint 4

The widgets (ADR-0044) read through the routes of Decision 5 and changed one of them.

1. **`summary` carries `points`**, the monthly points of each KPI that `series` returns (maintainer's choice in sprint 4, ADR-0044 Decision 10). The cards need the latest value and the sparkline's points; as two reads they would have doubled the calls of a dashboard. Every widget reads `summary`;
   `series` stays as the plain read of the values; the read store offers it (`series`) and no widget calls it. The answer still holds no person, run, source or file name (`response-fields.test.ts`).
2. **The defaults have a read route**, `GET /kpi/analytics/defaults` (ADR-0044 Decision 9): the repaired defaults with the default service resolved and the categories the filters offer. Decision 7 had left the defaults to the generic preference route, which cannot resolve the default service.
3. **The 200-KPI cap stays silent** (ADR-0044 Decision 15): `totalCount` tells a widget that a page is full, and a tile says "Showing the first 50 of N KPIs".

## Amended in sprint 6

Measured at the release (method and machine in `docs/backlog.md`, "Release follow-ups (M11 sprint 6)"): one service of 200 KPIs by 120 months and three more services, **49,800 measurements** in all; the service layer over real Postgres, median of 7 after 2 warm-ups.

| Read      | Window       | KPIs on the page | Service layer | Through the pipeline (in process) | Body    |
| --------- | ------------ | ---------------- | ------------- | --------------------------------- | ------- |
| `series`  | `1y`         | 50               | 12.8 ms       | 25.9 ms                           | 38 kB   |
| `summary` | `1y`         | 50               | 15.9 ms       | 17.7 ms                           | 46 kB   |
| `series`  | `1y`         | 200              | 29.2 ms       | 31.2 ms                           | 151 kB  |
| `summary` | `1y`         | 200              | 31.3 ms       | 40.7 ms                           | 184 kB  |
| `series`  | `all` (120m) | 50               | 70.2 ms       | 72.9 ms                           | 296 kB  |
| `summary` | `all`        | 50               | 75.0 ms       | 73.7 ms                           | 304 kB  |
| `series`  | `all`        | 200              | 138.5 ms      | 139.1 ms                          | 1.18 MB |
| `summary` | `all`        | 200              | 154.0 ms      | 153.2 ms                          | 1.21 MB |

The cost follows the number of points, not the number of measurements in the table (sprint 3 measured 35 and 138 ms at the same size for the `1y` and `all` pages of 200). The export of the same service for `1y` takes 44 ms as CSV (12.7 kB) and 48 ms as XLSX (16.9 kB). The sizes of Decision 5's bounds
stand: a 120-month, 200-KPI answer is the worst case at 1.2 MB, which is why the default page is 50 KPIs.
