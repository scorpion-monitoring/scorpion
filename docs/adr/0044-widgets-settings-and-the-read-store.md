# ADR-0044: the widgets, their settings and the shared read store

- Status: Accepted
- Date: 2026-10-21

## Context

M11 sprint 4 builds the widgets of FEATURES §3.8 on the grid of [ADR-0042](0042-dashboard-document-and-grid.md) and the reads of [ADR-0043](0043-analytics-calculations-ranges-and-exports.md)
([m11-sprint-plan.md](../m11-sprint-plan.md), §8). This ADR records the decisions of that sprint. Decisions 9 to 15 continue the numbering of the earlier ADRs (1 to 4 and 5 to 8).

**Checked against the source before starting** (the prompt and the plan name these; where they differ the source wins and the difference is under "What the source forced"): `dev` carries PR #121;
`AnalyticsService` has `series`, `summary`, `defaults(actor)` and `categories(actor)`; the rows of both reads are as the plan says (`points` with `value` and `text`, `latest`, `change`,
`average`, `volatility`); the `ui.widget` entry has `grid`, `label`, `description`, `icon`, `configSchema` and `singleton`; a widget receives `instance`, `config`, `editing`, `setConfig`
and `size`; `DashboardGrid` has the `settings` snippet and `hasSettings`; `GET /ui/navigation` listed `grid`, `label`, `description` and `icon` but **not** `configSchema` (a Zod schema is not JSON).

## Decision

### 9. The defaults have a read route

`GET /kpi/analytics/defaults`: internal, permission `kpi.analytics.read` on the route and again in `AnalyticsService.defaults(actor)`, about the caller only (no user id; one named in the query is ignored),
`Cache-Control: no-store`. It answers `{ service: string | null, range, category, categories: [{ key, label }] }`: the stored defaults **repaired**, the **default service resolved** (the stored one while it
exists, else the first service by name of the person's own providers, else `null`: never an arbitrary one) and the thematic categories the filters offer, which is the one vocabulary read the reads
already use (`categories(actor)`), so the defaults dialog and the widgets' own filters cannot list different terms (defect 10). It is a row of the walker and matrix of defect 1, of the route table and the
field tables of `docs/security/authorization.md` and of `response-fields.test.ts`, and it is in the typed client. The generic `PUT /preferences/kpi.analytics.defaults` stays the writer. No public v1 route
changed.

### 10. One shared read store in `packages/ui-kit`, and one read per (service, range) pair

`createAnalyticsReads(api)` returns `summary`, `series`, `defaults`, `service` and `terms`; each gives **one in-flight promise per distinct key** and keeps it for the visit (the dashboard makes one store when it mounts
and provides it by context; widgets read through it). The key is `readKey(kind, { service, range, category, indicators, page, pageSize })`: the KPIs trimmed, without duplicates and sorted, a page that is not a
whole number the default, JSON of a fixed order so no name can forge a separator. A read that fails is forgotten at once, so "Try again" sends a new one. The pure part is table-driven and has properties; the store
calls the API only through the typed client. Every widget asks for the same page (`WIDGET_PAGE_SIZE`, 50 KPIs) so that widgets over one service and range share one request.

**The call budget needed one additive change of the reads' contract** (the prompt says to stop and ask if it could not be met without one; the maintainer was asked and chose this): the cards need the latest
value and the change (`summary`) **and** the points of the sparkline (`series`), the trends chart the points, the averages and the volatility the figures. With two reads per pair the budget "two reads for eight
widgets over two pairs" cannot hold. **`GET /kpi/analytics/summary` now carries `points`** (the series read's, same shape, same order). Every widget reads `summary`; `series` stays for the exporters of sprint 5 and
for other callers. Additive on an internal route; `pnpm openapi:diff` is clean. Measured (`[dashboard-calls]`, both base paths): eight widgets over two pairs make **2** analytics reads on arrival, **0** on
edit mode, a move and a resize, **1** on a change of one widget's range; besides them the names of the two services (`GET /services/{id}`, 2) and the vocabulary of units (1) are read once each, and a tile that has
never been set up reads the defaults once.

### 11. The settings schema is derived from the Zod `configSchema` and listed in `GET /ui/navigation`

`z.toJSONSchema(configSchema, { io: 'input', unrepresentable: 'throw' })` runs once at start for each widget entry; the result (without `$schema`) is the new optional field `configSchema` of an entry of the
answer, for the widgets the caller may see. An entry with no `configSchema` answers as before (tested). **A schema JSON Schema cannot express** (`z.date()`, `z.bigint()`, a function) **stops the start, naming the
widget**; a `.transform()` is fine because the input side is what a form edits. The answer is public like the rest of the navigation but lists only what the caller may see, and a schema names fields and limits and no data.
`json-schema-check` (the browser's checker) learned `anyOf`, which is how Zod writes a nullable value.

### 12. One shared settings form and the defaults dialog, both in `packages/ui-kit`

`WidgetSettings` is drawn from the JSON Schema: `service` (a search box and a select over the services the person may read: reading is open to every holder of the plain permission, M10 decision 4, so the
list is the catalogue's and not the list of services they may report for; "Choose a service" is a value), `range` (the schema's values), `category` (the list of the defaults route), booleans and other string
enums. A field of another shape (the lists a chart keeps for itself) is not drawn and is kept exactly as it was. "Apply" checks the draft with the widget's schema and gives the new `config` to `setConfig`; the
dashboard saves it with the layout. It is opened from the gear of a tile through the `settings` snippet of `DashboardGrid` (the grid is not changed). `DashboardDefaults` is the dialog of FEATURES §3.8: the same
fields and lists, stored through `PUT /preferences/kpi.analytics.defaults` (no service is stored while none is chosen, instead of a `null` the store refuses). It is opened from the quick actions and from the
settings form.

### 13. What a tile's configuration holds

`MAX_CONFIG_BYTES` **stays 400**. The filter is `{ service?: uuid | null, range, category }`; **`service` absent means the tile was never set up** (it shows the person's defaults and, in edit mode, takes them: a new
widget starts with the defaults, and opening the page never writes), **`service: null` is a choice that was made** ("Choose a service", never an arbitrary service). The trends chart keeps **per-series** states
(`cumulative`, `hidden`, `secondary`; the plan's example had one boolean) as lists of **short ids**, the last 12 hex digits of a KPI's id (48 bits of the random part; a UUIDv7's start is a timestamp, so the end is used),
at most **14 in all**: full ids would not fit 400 bytes for more than a few KPIs. Measured with the longest filter (a 32-character category, `all`, a service id) and 14 states: under 400 bytes (a property test). Switching a state
on past the limit is refused with a message; switching one off always works. A configuration that fails its schema is replaced by the widget's defaults (`parseWidgetConfig`, a property test).

### 14. The volatility bands keep their edges

Below `low` is `low`, from `low` up to but not including `high` is `medium`, from `high` is `high`; 0.4 and 0.8 are module settings. The widget shows the band the server names, in words (colour is never the only signal);
the table of `band` has the edges (0.39, 0.4, 0.79, 0.8) since sprint 3.

### 15. The 200-KPI cap stays silent, and the widgets say when a page is full

No `truncated` field. The envelope's `metadata.totalCount` already says how many KPIs the service has in the window (up to the cap), and a widget that shows 50 says "Showing the first 50 of N KPIs. Choose a category to see
others." A service with more than 200 is still cut at 200 without a word (backlog).

## What the source forced (the plan or the prompt said otherwise, or said nothing)

1. **`kpi.analytics` needed `ui-kit` as a development dependency and a `./ui` export**, as `kpi.ingestion` has. `@scorpion/web` lists the module (the generated `ui.ts` imports its `ui` entry).
   The module's browser half imports only zod-free files (`service/widget-limits.ts`, `service/calc/cumulative.ts`): the `@scorpion/contracts` barrel and Zod stay out of the page.
2. **There was no icon for a chart**: `chart` joined the closed icon table.
3. **daisyUI centres a `<figure>` inside a `.card`** (it styles card images), which gave a chart a width of 0 in a tile. `Chart` states `items-stretch justify-start` on its figure.
4. **ECharts' HTML tooltip breaks the page's Content-Security-Policy** (it writes `style` attributes: the component spec saw 86 violations when the tooltip was shown). The tooltip is drawn inside the SVG
   (`renderMode: 'richText'`), in the colours of the theme, and the lines of the grid, the text and the tooltip all follow the theme, which closes the ⚠ of FEATURES §3.8 (the chart grid colours were not theme-aware).
5. **A table wider than its box scrolls**, and axe (`scrollable-region-focusable`) wants such a region focusable: `Chart`'s table region takes `tabindex="0"` when it is open. A chart is a focusable group
   (the arrow keys, Home, End and Escape step through the categories, a live region says the values).
6. **Two tiles of one widget had one name** ("Move Trends" twice). The name of a tile is its `label`, and a number in document order when the dashboard has several of the widget ("Trends (2)").
7. **A service option listed twice crashed the page** (`each_key_duplicate`) when the service of the tile arrived both from the search and from its id; the option list is built without duplicates.
8. **A widget that re-reads when its configuration object changes** tears its body down (the options of a chart close under the person's hand): the frame reads again only when its own service, range or category changes.
9. **The default dashboard now holds the cards, the trends chart and the quick actions** for everyone who holds `kpi.analytics.read` (the plan, §3). They sit below the three cards of earlier milestones; a person with no defaults sees
   "Choose a service." in them.
10. **`core.ui-shell`'s `Dashboard.svelte` knows the read store and the settings form** (both in `ui-kit`) and nothing of any widget: the shell still names no widget.
11. **The web server's bundle held ECharts and its source maps** (about 10 MB, 8.6 MB of it in `build/server`): the first image of the sprint was 14.2 MB larger than sprint 3's. The server never runs the chart
    (`chart-echarts.ts` is imported inside `onMount`), so `apps/web/vite.config.ts` marks `echarts` and `zrender` external for the `ssr` environment (`ssr.external` does not reach them: the web app bundles the linked `ui-kit`).
    The `full` image is then 3.5 MB (+0.70 %) larger than sprint 3's, which is the client build's growth in its three forms (raw, gzip, brotli) and the widgets' server rendering.
12. The housekeeping of sprint 3 is done: `kpi-framework`, `kpi-ingestion` and `kpi-analytics` are in the root `tsconfig.json` references (so `pnpm check` type-checks them), the type error of `reminder.test.ts` is fixed,
    and the contract test that searched a JSON string for `9999` now looks at the values.

## Consequences

- A dashboard of eight widgets over two (service, range) pairs makes two analytics reads; the number is asserted in the end-to-end spec under both base paths.
- The settings form of any widget is data (a JSON Schema) and one component; a new widget with a `configSchema` gets its gear and its form without a line of shell code.
- Widgets are `ui.widget` entries of `kpi.analytics`; the exporters of sprint 5 add buttons to the cards and the trends widgets and use `series` or `summary` as they need.
- The default dashboard of every user now makes reads on arrival (one for the defaults while no service is chosen; the cards and the chart read once for a person with a service). The bundle and image sizes are in the backlog.
- A configuration that is hand-planted through the generic preference route is repaired on read; a category that left the vocabulary shows "The settings of this widget are no longer valid".
- No new runtime dependency (`fast-check` is a development dependency of `kpi.analytics`, as elsewhere). No change to `apps/server/src/pipeline/**` or `packages/contracts/src/route.ts`.
