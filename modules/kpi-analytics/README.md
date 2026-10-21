# kpi.analytics

The numbers a dashboard shows: the values of a service month by month, and the change, the average and the volatility of each KPI, from **one tested
calculation library** and two reads, with the range and the thematic filter **always applied**. Defect 10 of [FEATURES.md](../../docs/FEATURES.md) §5
is what it must not repeat (no duration meant no date filter, a thematic list that was not the one of the defaults dialog, an arbitrary first
service). The decisions are in [ADR-0043](../../docs/adr/0043-analytics-calculations-ranges-and-exports.md), the plan in
[m11-sprint-plan.md](../../docs/m11-sprint-plan.md).

Status: M11 sprint 3: the module, the library, the registries, the reads, the settings and the defaults. **No widget, no chart, no exporter and no page yet**
(sprints 4 and 5). The module is in the `full` profile only.

## Manifest

| Part         | Value                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id           | `kpi.analytics` (package `@scorpion/kpi-analytics`)                                                                                                                                                                                                                                                                                                                                                               |
| tables       | **none**, and so no table prefix. The architecture's `dashboard_preference` is replaced by preference keys (ADR-0042 Decision 1, ADR-0043)                                                                                                                                                                                                                                                                        |
| dependencies | `core.authz`, `core.settings` (the vocabulary `thematic-category`, the preference, the module settings), `kpi.framework` (the effective KPI set and indicators through trusted reads), `kpi.ingestion` (the trusted series reads) and `registry.services` (a service exists, a person's providers' services). `core.ui-shell` is an **optional peer** (the widgets of sprint 4). Nothing depends on it before M12 |
| routes       | internal: `GET /kpi/analytics/series`, `GET /kpi/analytics/summary` (see "The reads")                                                                                                                                                                                                                                                                                                                             |
| registries   | declares `analytics.aggregate` and `analytics.score` and contributes their entries; `analytics.exporter` arrives in sprint 5. Contributes the user preference `kpi.analytics.defaults` (`settings.userPreference`) and the permission to the role `user` (`authz.defaultRole`)                                                                                                                                    |
| settings     | `volatility.thresholds.low` (0.4) and `.high` (0.8)                                                                                                                                                                                                                                                                                                                                                               |
| permissions  | the plain `kpi.analytics.read`, held by the role `user` and by Admin                                                                                                                                                                                                                                                                                                                                              |
| events, jobs | none                                                                                                                                                                                                                                                                                                                                                                                                              |

## The calculation library

[`service/calc/`](service/calc/) is pure: functions over numbers, exported through `public.ts`. A series is `(number | null)[]`, oldest month first, `null`
for a month with no value. **Every function returns a number or `null`, never throws, never returns `NaN` or an infinity, and never turns a gap into a
zero.** Table-driven tests (`calc.test.ts`) and `fast-check` properties (`calc.properties.test.ts`).

| Function                           | Meaning                                                                                                                                                                               | Undefined (`null`, shown "n/a") when                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `sum`, `avg`, `min`, `max`         | over the values that exist; a gap adds nothing. `avg` lies between `min` and `max` (rounding is clamped)                                                                              | there is no value, or the sum does not fit a number              |
| `changePercent`                    | `(newest - oldest) / abs(oldest) * 100`, the oldest and the newest being the first and last month **with** a value                                                                    | fewer than two values exist, or the oldest is 0                  |
| `cumulative`                       | the running total, one entry per month; a gap stays `null` and the total carries across it                                                                                            | (per entry) the month has no value, or the total overflows       |
| `mape`                             | **as the legacy page meant it**: the mean absolute percentage deviation from the mean, `mean(abs(v - mean)) / abs(mean)`, as a fraction (0.4 is 40 %). A constant series is exactly 0 | fewer than two values exist, or the mean is 0                    |
| `band(score, thresholds)`          | `low` below the low limit, `medium` up to the high limit, `high` from it                                                                                                              | the score is not defined, or the limits are not `0 < low < high` |
| `monthEnd`, `monthsBack`           | the last day of a month (29 February, 1900 was no leap year); the months ending with the month of a clock, oldest first                                                               | the month does not exist; the count is not a whole number from 1 |
| `alignToMonths`                    | lays points on the months of a window: gaps are `null`, months outside the window are left out                                                                                        | (never)                                                          |
| `durationSeconds`, `durationParts` | hours, minutes and seconds to seconds and back (the value type stores a duration as seconds)                                                                                          | a part is not a whole number in range                            |

The registry **`analytics.aggregate`** maps the terms of the vocabulary `aggregate` (`sum`, `avg`, `min`, `max`: data of `core.settings`) to functions;
**`analytics.score`** holds the scores of a series (`volatility`, which uses `mape` and `band`). An entry is `{ id, labels, apply }` or `{ id, labels, compute }`,
validated by a Zod schema at start; two entries with one id stop the start. Another module adds an aggregate or a score by contributing an entry. The module holds no list of
terms beyond the four functions.

## Ranges

`3m`, `6m`, `1y`, `2y` and `all`, counted back from **the current month by the injected clock** (UTC; the current month is the last month of the window, so it is
usually a gap until it is reported). **A range is always applied.** `all` is a value: the most months one read serves, **120**. A missing range is repaired to `1y`
(the fix of defect 10); a range that is not one is a 422 naming `range`, never "no filter". A window is an explicit list of months, so a KPI with a gap shows a gap.

## The reads

Both need `kpi.analytics.read` on the route and again in the service, are open to every holder for **every service** (decision 13 of the plan; as the
measurements are), and are never anonymous and never public v1. Query: `service` (an id; required), `range`, `category`, `indicators` (ids or names, comma
separated, at most 50), and `page` and `pageSize` (default 50, at most 200; pages count from 0). A page is a page of **KPIs**, in the envelope every list uses.

| Route                        | Answer                                                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /kpi/analytics/series`  | per KPI: `indicatorId`, `name`, `valueType`, `unit`, `thematic`, `necessity`, `current`, and `points`: one `{ period, value, text }` per month of the window |
| `GET /kpi/analytics/summary` | per KPI: the same fields and `latest` (`period`, `value`, `text`), `change` (percent), `average`, `volatility` (`value`, `band`)                             |

- **The KPIs** are the effective KPIs of the service plus **any KPI it has dropped that still has values in the window** (`current: false`, `necessity: null`), by name without case then id, at most 200.
- **The category** is read from the vocabulary `thematic-category` (the one read `categories()` uses, which also serves the defaults): an unknown one is a 422 naming `category`; `all` or none means every category.
- **Points.** A number is `value` with `text: null`; a **text value** is `text` with `value: null` and is **never parsed to a number**; a gap is `value: null, text: null`, never zero. A duration is seconds in `value`.
- **422** names `service` (not an id, or no such service), `range`, `category` or `indicators`, all at once. A service with no KPIs is an empty list.
- The answers hold **no person, run, source, file name or row id** (`response-fields.test.ts`; the field table is in `docs/security/authorization.md`).

The values come from `kpi.ingestion` through its trusted `reads.seriesAsSystem` and `reads.measuredIndicatorsAsSystem` (no permission, no route, at most 120 months and 200
indicators), the KPIs from `kpi.framework`'s trusted reads (which now carry `thematic`). The module reads no table.

## Settings

`volatility.thresholds` (`low` 0.4, `high` 0.8) on the generic settings page: `0 < low < high <= 5`. A value outside is **refused (422), never clamped**. A change takes effect on the next read.

## The defaults preference

`kpi.analytics.defaults` (`settings.userPreference`, own data only): `{ service?, range, category }`, seeding the configuration of a **new** widget. The store checks the shape of a
write (a range that is not one, a service that is not an id: 422). `parseDefaults(raw, categories)` is pure and **never throws**: a bad service is dropped, a missing or unknown range becomes `1y`,
a category that is not `all` and not an active term of the vocabulary becomes `all`. `service.defaults(actor)` adds the default service: the stored one while it exists, else
**the first service of the person's providers by name** (`defaultServiceOfAsSystem`, through `registry.services`), else **none** (`null`), never an arbitrary first service.

## What undefined means

A figure the data cannot support is `null`, and the page says "n/a": a change with fewer than two values or from 0, a volatility with fewer than two values or a mean of 0, an average of
nothing, any figure of a text KPI. It is never `0`, `NaN` or a guess.

## Tests

`service/calc/calc.test.ts` and `calc.properties.test.ts` (the library), `service/analytics.test.ts` (the reads on real Postgres, tagged for V8), `service/defaults.test.ts`,
`settings-schema.test.ts`, `module.test.ts` (no table, the registries and the layers), `defect-10.dashboard-filters.test.ts` (never weaken), and in `apps/server`:
`analytics-routes.test.ts`, the analytics block of `defect-01.privilege-escalation.test.ts` and `response-fields.test.ts`.
