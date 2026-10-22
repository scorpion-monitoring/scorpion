# kpi.analytics

The numbers a dashboard shows: the values of a service month by month, and the change, the average and the volatility of each KPI, from **one tested
calculation library** and two reads, with the range and the thematic filter **always applied**. Defect 10 of [FEATURES.md](../../docs/FEATURES.md) §5
is what it must not repeat (no duration meant no date filter, a thematic list that was not the one of the defaults dialog, an arbitrary first
service). The decisions are in [ADR-0043](../../docs/adr/0043-analytics-calculations-ranges-and-exports.md) and [ADR-0044](../../docs/adr/0044-widgets-settings-and-the-read-store.md), the plan in
[m11-sprint-plan.md](../../docs/m11-sprint-plan.md).

Status: released in `0.13.0` (M11): the module, the library, the registries, the reads, the settings, the defaults, the widgets of the dashboard and their settings, and **the exporters** (CSV and XLSX). The module has no page of its own: its widgets are tiles of the dashboard of `core.ui-shell`. The module is in the `full` profile only.

## Manifest

| Part         | Value                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id           | `kpi.analytics` (package `@scorpion/kpi-analytics`)                                                                                                                                                                                                                                                                                                                                                               |
| tables       | **none**, and so no table prefix. The architecture's `dashboard_preference` is replaced by preference keys (ADR-0042 Decision 1, ADR-0043)                                                                                                                                                                                                                                                                        |
| dependencies | `core.authz`, `core.settings` (the vocabulary `thematic-category`, the preference, the module settings), `kpi.framework` (the effective KPI set and indicators through trusted reads), `kpi.ingestion` (the trusted series reads) and `registry.services` (a service exists, a person's providers' services). `core.ui-shell` is an **optional peer** (the widgets of sprint 4). Nothing depends on it before M12 |
| routes       | internal: `GET /kpi/analytics/series`, `GET /kpi/analytics/summary`, `GET /kpi/analytics/defaults`, `GET /kpi/analytics/export` (see "The reads", "The defaults route" and "The exporters")                                                                                                                                                                                                                       |
| registries   | declares `analytics.aggregate`, `analytics.score` and `analytics.exporter` and contributes their entries (CSV and XLSX for the last). Contributes the user preference `kpi.analytics.defaults` (`settings.userPreference`), the permission to the role `user` (`authz.defaultRole`) and **five entries of `ui.widget`** (see "The widgets")                                                                       |
| ui           | `ui/index.ts` (package export `./ui`): the widgets, their texts in English and German and no page. The server half is `ui/routes.ts`; `ui/ui.test.ts` checks that the two agree                                                                                                                                                                                                                                   |
| settings     | `volatility.thresholds.low` (0.4) and `.high` (0.8)                                                                                                                                                                                                                                                                                                                                                               |
| permissions  | the plain `kpi.analytics.read` and `kpi.analytics.export`, both held by the role `user` and by Admin                                                                                                                                                                                                                                                                                                              |
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

| Route                        | Answer                                                                                                                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /kpi/analytics/series`  | per KPI: `indicatorId`, `name`, `valueType`, `unit`, `thematic`, `necessity`, `current`, and `points`: one `{ period, value, text }` per month of the window                                                        |
| `GET /kpi/analytics/summary` | per KPI: the same fields, **`points`** (the series read's, so one read serves every widget of a dashboard), and `latest` (`period`, `value`, `text`), `change` (percent), `average`, `volatility` (`value`, `band`) |

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

## The defaults route

`GET /kpi/analytics/defaults` (permission `kpi.analytics.read` on the route and again in `service.defaults(actor)`; **about the caller only, no user id**; `Cache-Control: no-store`) answers
`{ service: string | null, range, category, categories: [{ key, label }] }`: the stored defaults **repaired** (a range that is not one is `1y`, a category that is no longer a term is `all`),
the **default service resolved** (the stored one while it exists, else the first service by name of the person's own providers, else `null`: never an arbitrary one) and the **thematic
categories the filters offer**, the one vocabulary read the reads use. The generic `PUT /preferences/kpi.analytics.defaults` stays the writer (`DashboardDefaults` in `packages/ui-kit` calls it).

## The widgets

Five entries of `ui.widget` (`ui/routes.ts`), all `permission: kpi.analytics.read`, contributed through the module's `ui` entry; the shell knows none by name. The numbers come from `summary` through the
dashboard's **shared read store** (`packages/ui-kit/src/read-store.ts`): one in-flight read per distinct (service, range, category, KPIs, page), so a dashboard of eight widgets over two (service, range) pairs
sends **two** reads, none on a move, a resize or a toggle of a chart's series, and one on a change of a widget's range. A widget calculates nothing.

| Widget `id` (component)                   | What it shows                                                                                                                                                                                                                                  | Default place  |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `kpi.analytics.cards` (`cards`)           | per KPI the latest value with its unit, the change as ▲ ▼ **and the words "up", "down", "unchanged"**, an SVG sparkline with a text alternative; a text KPI shows its text and no change. A scrolling list with the count announced            | `0,3` 4×5      |
| `kpi.analytics.trends` (`trends`)         | one line per KPI through the chart adapter (theme-aware lines, text and tooltip); per KPI **running total**, **show/hide** and **second axis**, kept in the tile's `config`; the table of the numbers; the arrow keys read it                  | `4,3` 8×5      |
| `kpi.analytics.averages` (`averages`)     | a compact table of the average of each KPI ("n/a" where it is not defined)                                                                                                                                                                     | placeable only |
| `kpi.analytics.volatility` (`volatility`) | a bar per KPI with the value and the **band in words** (low, medium, high); the explanation is a disclosure button (keyboard and touch). Bands keep their edges: below `low` is low, from `low` to below `high` is medium, from `high` is high | placeable only |
| `kpi.analytics.actions` (`actions`)       | links to Report data (the Data Submission page, when the person may open it), Services and Notification preferences, built with the base path, and the **Dashboard defaults** dialog. A `singleton`, no settings                               | `0,8` 4×3      |

The cards, the trends chart and the quick actions are in the **default dashboard** (the places are below the three cards of earlier milestones); the other two are added from the FAB menu.

**Configuration** (`service/widget-config.ts`, `config` of a tile, at most 400 bytes as JSON; the JSON Schema of each is listed in `GET /ui/navigation` and draws the settings form):

- cards, averages, volatility: `{ service?: uuid | null, range: '3m' | '6m' | '1y' | '2y' | 'all' (default '1y'), category: <key> | 'all' (default 'all') }`;
- trends: the same and `cumulative`, `hidden`, `secondary`: lists of **short ids** (the last 12 hex digits of a KPI's id) of at most **14 in all**, so the configuration fits 400 bytes.
- **`service` absent** means the tile was never set up: it shows the person's defaults and, **in edit mode**, takes them (a new widget starts with the defaults; opening the page never writes).
  **`service: null`** is a choice that was made, "Choose a service". The range and the category are always applied (defect 10).
- A configuration that fails its schema is replaced by the widget's defaults (`parseWidgetConfig`, never throws; a property test).

**States** (each a `role="status"` or an `Alert`, never a blank tile): "Choose a service.", loading, "This service has no KPIs.", "No values for this range.", a failed read with "Try again", and a
422 (the category left the vocabulary) which asks the person to open the settings. A page of KPIs is 50; more are said ("Showing the first 50 of N KPIs"; the server serves at most 200 of a service).

**Accessibility**: every tile has a heading; every chart has its table; the sparkline and the volatility bar have text alternatives; scrolling regions take focus; both themes and reduced motion; axe in
`apps/web/e2e/dashboard-widgets.spec.ts`.

## The exporters

`GET /kpi/analytics/export?service=&range=&category=&format=csv|xlsx` (internal; permission **`kpi.analytics.export`** on the route, audited, the default rate bucket, and `ctx.authz.require` again in `service.export` **before** anything else is looked at). It answers a **file** as an attachment, for
the window of the range, every KPI of the category (at most 200) and at most 120 months, the bounds of the reads. The permission to read is not the permission to export. Query: `service` (an id), `range`, `category` as in the reads, and `format`, **a key of the registry `analytics.exporter`**; an unknown format, a bad parameter or an extra one is a **422 problem+json** naming it, never a 500.

- **The table** (`service/export-table.ts`, one pure function, `buildTable`): the headings `KPI` and `Unit`, then **one column per month of the union of the months of all the series** (`YYYY-MM`), and **one row per KPI**: its name, the label of its unit, one value per month, **empty where a KPI has none** (a gap is never a zero). The legacy export read the months of the first KPI and put every other KPI's values under them. A text value is text. No instance name, contact or other branding is in the file.
- **Escaping.** Every text cell (headings, names, units, text values) goes through `escapeCell` of `kpi.ingestion/public.ts`: a cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading `'`. A **number is a number** and not escaped (a negative value is not a formula), so the file parses back to the numbers of the series.
- **CSV**: UTF-8 **with a byte order mark** (as the import templates), CRLF, a field quoted only where it must be. **XLSX** (`write-excel-file`): the headings and text are text cells with the text format `@`, so a spreadsheet does not turn `2026-05` into a date; a number is a number cell. The package is declared at the exact version `kpi.ingestion` pins: no new package in the lockfile.
- **The file name** is the service's abbreviation (its slug, reduced to `a-z0-9-`), `kpis`, the range and the extension, e.g. `de-nbi-kpis-1y.xlsx`; never free text. Headers: `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`.
- **The registry `analytics.exporter`** (entry `{ id, labels, extension, mediaType, write(table) }`, validated by a Zod schema at start; two entries with one id stop the start). CSV and XLSX are the module's own; another module adds a format by contributing an entry.
- **The Export menu** of the trends and the cards widgets (`ui/ExportMenu.svelte`, in the frame of the tile): one request through the typed client per choice, the file saved through a blob URL under the server's name; progress and failure are said in a status line. The menu lists CSV and XLSX (backlog: it does not read the registry).

## What undefined means

A figure the data cannot support is `null`, and the page says "n/a": a change with fewer than two values or from 0, a volatility with fewer than two values or a mean of 0, an average of
nothing, any figure of a text KPI. It is never `0`, `NaN` or a guess.

## Tests

`service/calc/calc.test.ts` and `calc.properties.test.ts` (the library), `service/analytics.test.ts` (the reads on real Postgres, tagged for V8), `service/export-table.test.ts` (the table: different months, gaps, umlauts, the injection characters) and `service/exporters.test.ts` (CSV, XLSX read back with `read-excel-file`, the entry schema), `service/defaults.test.ts`, `service/widget-config.test.ts` (the configuration of the widgets, with properties),
`ui/*.test.ts` (the pure helpers of the widgets: the formatting of a change, the sparkline path, the series states, the agreement of the two halves and the catalogue),
`settings-schema.test.ts`, `module.test.ts` (no table, the registries and the layers), `defect-10.dashboard-filters.test.ts` (never weaken), and in `apps/server`:
`analytics-routes.test.ts`, `analytics-export-routes.test.ts` (the export through the pipeline), the analytics block of `defect-01.privilege-escalation.test.ts` and `response-fields.test.ts`; the journeys of the widgets under both base paths are in
`apps/web/e2e/dashboard-widgets.spec.ts`.
