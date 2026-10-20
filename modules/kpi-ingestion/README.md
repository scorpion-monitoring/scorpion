# kpi.ingestion

The measurements of the instance: one value of one indicator of one service for one month, and the one way to write them. Defect 6 of
[FEATURES.md](../../docs/FEATURES.md) §5 is what it must not repeat (an insert-only submission, two code paths, an unchecked value that became
a 500 or half a batch). The decisions are in [ADR-0041](../../docs/adr/0041-measurement-model.md), the plan in
[m10-sprint-plan.md](../../docs/m10-sprint-plan.md). It builds on `kpi.framework` (the indicators, the value types, the KPIs of a service) and
on `registry.services` (a service exists, who belongs to its provider).

Status: M10 sprint 3: the tables, the pure period, value and name functions, `upsertBatch` and `upsertByName`, the scoped permission and its policy, the
event, the in-use contribution, the two v1 routes and the two internal reads (sprints 1 and 2), and now the registry `ingestion.adapter` with the form, CSV/TSV and
XLSX adapters, preview, dry run and commit, the run history and the import templates (sprint 3). There is **no page yet** (sprint 4 adds the Data Submission page,
sprint 5 the reminder). The module is in the `full` profile only.

## Manifest

| Part         | Value                                                                                                                                                                                                                                                                                                                                        |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id           | `kpi.ingestion` (package `@scorpion/kpi-ingestion`)                                                                                                                                                                                                                                                                                          |
| table prefix | `kpii_` (set in the manifest; ADR-0004): `kpii_measurement`, `kpii_ingestion_run`. `kpi.framework` uses `kpif_`                                                                                                                                                                                                                              |
| dependencies | `core.authz`, `kpi.framework` (the effective KPI set and the indicators through trusted reads, the value types, the usage registry) and `registry.services` (a service exists; who is a member of its provider). Nothing depends on it before M11. Only what the code imports is declared; the others arrive with the sprint that needs them |
| routes       | `GET` and `POST /api/v1/measurements` (the public API); internal: `GET /kpi/measurements`, `GET /kpi/measurements/coverage`, `POST /kpi/ingestion/preview`, `POST` and `GET /kpi/ingestion/runs`, `GET /kpi/ingestion/runs/{id}`, `GET /kpi/ingestion/adapters`, `GET /kpi/ingestion/template`; see "Routes"                                 |
| ui           | none yet                                                                                                                                                                                                                                                                                                                                     |
| events       | emits `measurement.recorded@1` (see "Events")                                                                                                                                                                                                                                                                                                |
| registries   | declares `ingestion.adapter` (see "Adapters") and contributes its three entries; contributes an `authz.resourcePolicy` entry for the resource type `service` and an entry to `kpi.framework`'s registry `kpi.indicatorUsage`                                                                                                                 |
| settings     | none yet (the reminder's two settings arrive in sprint 5)                                                                                                                                                                                                                                                                                    |
| permissions  | the service-scoped `kpi.ingestion.measurement.submit` and the plain `kpi.ingestion.v1.read`, `kpi.ingestion.v1.write`, `kpi.ingestion.measurement.read` and `kpi.ingestion.measurement.ingest`; the role `user` holds the four plain ones (see "Permissions")                                                                                |

## The model

| Table                | Holds                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kpii_measurement`   | `id` (UUIDv7), `service_id` (a **plain column**: no foreign key to `svc_service`), `indicator_id` (`kpif_indicator`, **restrict**), `period` (a date, **the last day of its month**), `value_numeric` (`numeric`, finite) **or** `value_text` (1 to 4 000 characters), `source` (the adapter id; `api` for v1), `run_id` (`kpii_ingestion_run`, `set null`), audit columns. **Unique `(service_id, indicator_id, period)`** |
| `kpii_ingestion_run` | `id`, `service_id`, `adapter`, `actor_id`, `file_name` (at most 120), `status` (`committed` or `rejected`), the four counts, `problems` (a JSON list of at most 100), `started_at`, `finished_at`. Written by `ingestion.run` (see "Runs"); a dry run is never stored                                                                                                                                                       |

Rules the database enforces for every writer (tested in [db/constraints.test.ts](db/constraints.test.ts)): the period is the last day of a month
(every month length, 29 February in 1900, 2000 and 2024), exactly one of the two value columns is set, a number is finite, the text and the
source are bounded, the same month of the same indicator of the same service is one row, an indicator with measurements is not deleted, a deleted
run leaves its measurements. A value is stored in its **canonical form**: the registry `kpi.valueType` decides whether a type is `numeric`
(then `value_numeric`) or not (then `value_text`), and a duration is seconds. There is no pg enum and no list of vocabulary terms.

The foreign key to `kpif_indicator` is written by hand at the end of `migrations/0000_measurement_core.sql` (Drizzle cannot name another
package's table without importing its schema); the migration test and a constraint test prove it.

## Period and value (pure)

- [`normalisePeriod(input, now)`](service/period.ts): `YYYY-MM` or `YYYY-MM-DD` (any day of the month) to the last day of that month; refuses a
  time, another format, an impossible month or day, a year before 1900 and a month after the current one in UTC. The clock is a parameter.
- [`toColumns` and `fromColumns`](service/values.ts): the canonical value to the two columns and back; `sameColumns` compares two stored values
  (numbers by value).

Both are table-driven in `service/period.test.ts` and `service/values.test.ts`.

## `upsertBatch`

```ts
ctx.deps['kpi.ingestion'].measurements.upsertBatch(actor, serviceId, rows, { source, runId?, dryRun? })
// rows: { indicator: <indicator id>, period: 'YYYY-MM' | 'YYYY-MM-DD', value: <what the type accepts> }[]
// → { inserted, updated, unchanged, rejected, rows: [{ index, verdict: 'insert' | 'update' | 'unchanged' | 'reject', problems? }] }
```

The only code that writes `kpii_measurement` (a walker in `module.test.ts` fails on another writer); the form, CSV, XLSX, the routes and the migration
tool call it. Order of the answers: **401, 403, 404, 422**.

| Step                 | What                                                                                                                                                                                                                                                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| permission           | `ctx.authz.require(actor, 'kpi.ingestion.measurement.submit', { type: 'service', id })`: Admin, or an approved member of the service's provider                                                                                                                                                                       |
| the service          | exists (`registry.services/public`), else 404                                                                                                                                                                                                                                                                         |
| the batch            | a list of 1 to 25 000 rows (values; 120 months of 200 indicators) covering at most 120 distinct months, a `source` of lower-case letters, digits and `-`, a `runId` that is an id: else 422 on `rows`, `source` or `runId`                                                                                            |
| each row             | `indicator` is in the service's **effective KPI set now** (`effectiveIndicatorsAsSystem`, a trusted read of `kpi.framework` made after the scoped check), `period` is valid and not after the current month, `value` is what the indicator's type and bounds accept (`valueType.schema({ min, max })`); no other keys |
| the batch as a whole | the same indicator and month twice is refused on the later row (`rows[j].period`, naming `rows[i]`), never "last wins"                                                                                                                                                                                                |
| a bad row            | **one 422 naming every bad path** (`rows[3].value`, at most 100; the message says how many), nothing written, no event. No message repeats a value, a name or a cell                                                                                                                                                  |
| the write            | one transaction, one `insert … on conflict (service_id, indicator_id, period) do update … where the value differs` per 1 000 rows (sorted by indicator and period, so concurrent batches do not wait in a circle)                                                                                                     |
| counts               | `inserted`, `updated`, and `unchanged` (the same value again: not written, `updated_at` stays), from the statement itself                                                                                                                                                                                             |
| the event            | `measurement.recorded@1` once per batch **when something changed**                                                                                                                                                                                                                                                    |
| `dryRun`             | everything but the write and the event; the same verdicts; a bad row is a `reject` with its problems; a batch wrong as a whole is still refused                                                                                                                                                                       |

A measurement of an indicator that the service has since dropped **stays**; the reads return it, and the KPI history of
`kpi.framework` (`kpisInPeriod`) tells which KPIs a month had.

An unknown run is a 422 on `runId`; an indicator deleted after its set was read is a 409. Neither is a 500.

## Permissions

| Permission                         | Grants                                                                                                                                          | Held by                                                                                                                                                                                                                                               |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kpi.ingestion.measurement.submit` | submit measurements for one service; **scope `service`** (ADR-0034, ADR-0036, ADR-0041)                                                         | Admin; the approved **members** of the service's provider (a manager is a member too) through this module's policy. No default role: a requested, rejected or left membership, a member of another provider, a Reviewer and a plain user hold nothing |
| `kpi.ingestion.v1.read`            | `GET /api/v1/measurements`: the time series of a service                                                                                        | the role `user` (every signed-in person reads every service's measurements, as services and KPI definitions are readable); a token needs the scope                                                                                                    |
| `kpi.ingestion.v1.write`           | `POST /api/v1/measurements`, together with `measurement.submit` for the token's owner                                                           | the role `user`; **not enough alone**: the service checks `submit` for the caller, so a plain user, a member of another provider and a token without the scoped permission are 403                                                                    |
| `kpi.ingestion.measurement.read`   | `GET /kpi/measurements` (the grid of a month), `GET /kpi/measurements/coverage`, the runs, the adapters and the template on the signed-in pages | the role `user`; for the runs and the template the service also checks `submit` on the service                                                                                                                                                        |
| `kpi.ingestion.measurement.ingest` | `POST /kpi/ingestion/preview` and `POST /kpi/ingestion/runs` (a file or a form on the signed-in pages)                                          | the role `user`; **not enough alone**: the service checks `submit` on the service for the caller. A permission of its own so that a token that may only read the grid cannot write                                                                    |

The policy ([service/policy.ts](service/policy.ts)) asks `registry.services/public`'s `isProviderMemberAsSystem` at **every call** and keeps
nothing, so a removal or a leave is seen at the next call. The routes name a plain permission and the service is the authorization
(ADR-0034): `upsertBatch` checks `submit` for the service, the reads check their plain permission again. **A token** is limited by its scopes and by
what its owner holds (ADR-0015): to write it needs `kpi.ingestion.v1.write` **and** `kpi.ingestion.measurement.submit`, and an owner who may submit for
the service. It needs no scope of `kpi.framework`: the KPIs and their bounds are read through trusted reads after the scoped check (ADR-0041,
"Amended in sprint 2").

## Routes

| Route                                                              | Permission                         | What it does                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/v1/measurements`                                         | `kpi.ingestion.v1.read`            | The values of one service (`service`: id or abbreviation, required), filtered by `indicators` (names without case or ids, comma-separated), `start` and `stop` (`YYYY-MM` or `YYYY-MM-DD`). The legacy envelope with `result` (not the legacy `data`), 0-based pages, `pageSize` at most 100, ordered by month, indicator name without case, id across pages |
| `POST /api/v1/measurements?service=`                               | `kpi.ingestion.v1.write`           | Upserts `[{ kpi, value, date }]` (1 to 500 items, at most 3 MiB, 413 above): `kpi` is the indicator's name without case or its id. 200 `{ inserted, updated, unchanged }`; all or nothing; 422 names `[i].kpi`, `[i].value`, `[i].date` or `service`; 403 for a caller who may not submit for that service. Source `api`                                     |
| `GET /kpi/measurements?service=&period=`                           | `kpi.ingestion.measurement.read`   | The grid of one month for the page of sprint 4: each indicator of the effective KPI set with its stored value or `measurement: null`. Paged (`pageSize` up to 500, default 200)                                                                                                                                                                              |
| `POST /kpi/ingestion/preview`                                      | `kpi.ingestion.measurement.ingest` | Multipart (`file`, `serviceId`, `adapter?`, `mapping?` as JSON text, `sheet?`) or JSON (`serviceId`, `form`): the header, 20 rows, the mapping and the problems. Needs `submit` on the service. `maxBodyBytes` 2 MiB + 64 KiB                                                                                                                                |
| `POST /kpi/ingestion/runs`                                         | `kpi.ingestion.measurement.ingest` | The same body plus `dryRun`: the verdicts of a dry run (200), a committed run (200) or the whole file refused (422 naming each `rows[r].columns[c]` and the recorded run)                                                                                                                                                                                    |
| `GET /kpi/ingestion/runs?service=`, `GET /kpi/ingestion/runs/{id}` | `kpi.ingestion.measurement.read`   | The history of a service (the last 50) and one run; `submit` on the service                                                                                                                                                                                                                                                                                  |
| `GET /kpi/ingestion/adapters`                                      | `kpi.ingestion.measurement.read`   | The entries of the registry: what the page offers and accepts                                                                                                                                                                                                                                                                                                |
| `GET /kpi/ingestion/template?service=&format=`                     | `kpi.ingestion.measurement.read`   | The import template as an attachment (`nosniff`, `no-store`); `submit` on the service                                                                                                                                                                                                                                                                        |
| `GET /kpi/measurements/coverage?service=`                          | `kpi.ingestion.measurement.read`   | The last `months` (default 12, at most 36) months, oldest first: how many effective indicators and how many mandatory ones have a value, and whether nothing mandatory is missing. The mandatory ones are those of the KPI set as it is now (the necessity term `mandatory`)                                                                                 |

A row of the time series is `{ kpi, value, date, id, indicatorId, iri, service, period, valueNumber }`: the legacy `kpi`, `value` and `date` and what is
added. `value` is the **canonical text** the legacy API returned (the value type formats it: a duration as `HH-MM-SS`, a number as a decimal) and
`valueNumber` the number (a duration in seconds) or `null` for text. A row never holds the id of the person who wrote it, a source, a run or a file name
(`response-fields.test.ts`). A value of an indicator the service has since dropped is still listed, and the indicator can be asked for by name.

The routes are thin: Zod parses, one service call (`reads.list`, `reads.grid`, `reads.coverage`, `measurements.upsertByName`), the row is mapped
field by field. The write route sets `maxBodyBytes` to 3 MiB: 500 items of the legacy shape are about 60 kB, but a text value may be 4 000 characters, so the
worst plain-ASCII batch is about 2.1 MB; the server-wide 1 MiB would refuse a batch the schema accepts. The preflight for the path names `GET, POST,
OPTIONS` (`apps/server/src/preflight.ts`); the other v1 paths name `GET, OPTIONS`.

## Adapters (`ingestion.adapter`)

An adapter turns what a person gives into rows `{ indicator, period, value }` and problems. **It never writes**: `upsertBatch` writes, so every adapter shares one path
and the same rules. The module declares the registry; entries are validated by a Zod schema at start (a bad entry names its module; two with one id stop the start), and the
service never asks an adapter's id: it asks what the entry says it accepts and whether its `sniff` recognises the bytes. Three entries come with the module:

| Adapter | Takes                                                                                                                      | Template             |
| ------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `form`  | `{ period, values: { <indicator id>: text } }`; a blank value is no value, an error only for a mandatory indicator         | none                 |
| `csv`   | CSV, TSV or text (`csv`, `tsv`, `txt`); UTF-8 with or without a BOM; comma, semicolon or tab, detected from the first line | UTF-8 CSV with a BOM |
| `xlsx`  | an XLSX workbook; the first sheet, or the one named                                                                        | XLSX                 |

**To add an adapter** (a REST pull, Matomo): a module that depends on `kpi.ingestion` contributes an entry to `ingestion.adapter`:

```ts
contributes: {
  'ingestion.adapter': [{
    id: 'matomo', labels: { en: 'Matomo', de: 'Matomo' },
    input: 'values',                       // 'file' (bytes) or 'values' (a form or a program)
    accepts: { extensions: [], mediaTypes: [] },
    // sniff?: (bytes) => boolean         // a file adapter: do these bytes look like mine? The content decides, the extension is a hint
    // template?: { extension, contentType, write(rows) } // an import template, if it has one
    parse(input, context) { /* → { header, preview, totalRows, targets, mapping, proposed, missing, rows, problems } */ },
  }],
}
```

`context` holds the service's effective KPI set (`indicatorId`, `name`, `mandatory`, `valueType`, `unit`) and the injected clock. A file adapter reads bytes into a `Table` and
ends with `fromTable(...)`, which does the mapping below; a problem is `{ row, column, code }` and never holds a cell. No code in this module branches on an adapter id.

### The mapping of columns (file adapters)

The first row is the header. Each column maps to the **period** or to **one indicator of the service**, each target at most once; the mapping is `{ "<0-based column>": "period" | "<indicator id>" }`.
Without one in the request the adapter proposes it from the header: `Period`, `Month`, `Date`, `Periode`, `Monat` or `Datum` is the period; any other header goes through
`resolveIndicatorRef` (an id, or a name without case that exactly one indicator has), then again without the template's decoration (` (unit)` and ` *`), and a leading `'` (see "Import template") is taken off first.
A column that matches nothing is ignored. **Required:** the period column and every **mandatory** indicator (the legacy rule); `missing` names what has no column, and a file that lacks one is
refused. A row with no value in any mapped column is skipped (the empty rows of an export, the template's example row); a row with a value and no period is a problem; a blank
cell is no value, an error for a mandatory indicator.
Cells are text: a number cell is its shortest text, a date cell `YYYY-MM-DD`, a boolean is a `cell-type` problem. Whether a text is a valid value for its indicator is `upsertBatch`'s verdict, so there is one rule.

### Limits

| What          | Limit                                                                                                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| file          | 2 MiB (the route's body limit is 2 MiB + 64 KiB for the multipart envelope; a body over it is 413 before it is read, a file over 2 MiB inside it is 422)                                                      |
| rows, columns | 5 000 data rows and 200 columns; a field of 4 000 characters; at most 100 problems listed                                                                                                                     |
| XLSX          | at most 20 MiB inflated and 1 000 zip entries; one sheet; an encrypted or password-protected workbook is refused; a formula is read as its cached value and **never evaluated**; no external link is followed |
| a batch       | 25 000 values and 120 distinct months (`upsertBatch`)                                                                                                                                                         |
| an echo       | a cell is never shown beyond 64 characters; a problem never holds a cell                                                                                                                                      |

### The XLSX guard

`read-excel-file` has no inflation cap (a 63 kB zip bomb that inflates to 60 MB ran for 60 s and crashed it), so [`service/xlsx-guard.ts`](service/xlsx-guard.ts) runs first and the reader
only ever sees bytes that passed: the central directory is read without inflating (not a zip, an OLE2 password-protected file, more than 1 000 entries, an encrypted entry, Zip64, declared sizes over
the cap), then the real output is counted while inflating in 4 KiB slices with `fflate`, because a declared size can lie. The bomb is refused in under 1 ms, a bomb with lying headers after about 200 ms.
The reader is the `read-excel-file/node` entry (a worker thread, takes a Buffer; about 25% faster than `universal` in the measurement of ADR-0041).

### Files are never stored

A file is parsed in memory and dropped. A run keeps counts, at most 100 problems and a **sanitised, bounded file name** (no path, no control or markup character, at most 120 characters).
The content decides the adapter, not the extension: a workbook saved as `.csv` is read as a workbook, text named `.xlsx` as text, and a file that is neither is a `format` problem, not a 500.

## Preview, dry run and commit

`ingestion.preview(actor, input)` answers the header, the first 20 rows, the mapping (given or proposed), what is missing and the problems; it writes nothing. `ingestion.run(actor, { …, dryRun })`
**parses again from the same bytes** (the client never sends parsed rows: one trust path) and runs `upsertBatch` with `dryRun`:

- `dryRun: true`: the verdict of each value (`insert`, `update`, `unchanged`, `reject`) with its row and column; nothing is written or stored.
- `dryRun: false`: if anything is rejected the **whole file is refused** and the refusal is recorded as a run (`rejected`, its counts and problems, nothing else). Otherwise the run, the values and the
  event are written in **one transaction** (`upsertBatch` runs inside it as a savepoint), so a failure anywhere leaves none of them.

Both checks need `kpi.ingestion.measurement.submit` on the service, in the service (anonymous 401, a plain user, a Reviewer, a requested, rejected or left member and a member of another provider 403).
A request wrong as a whole (neither or both of a file and a form, an unknown adapter, an empty or oversized file, no values, a service with no KPI set) is a 422 and is not recorded.

## Runs

`kpii_ingestion_run` holds what a file or a form did: the adapter, who ran it (a user id), the sanitised file name, `committed` or `rejected`, `inserted`, `updated`, `unchanged`, `rejected`, at most 100
problems `{ row, column, code }` and the times (from the injected clock). `GET /kpi/ingestion/runs?service=` lists the last 50, newest first; `GET /kpi/ingestion/runs/{id}` reads one. Both need `submit` on the run's service.

## Import template

`GET /kpi/ingestion/template?service=&format=csv|xlsx`: a header row (`Period`, then each indicator of the effective KPI set as `Name (unit)` with ` *` for a mandatory one) and an example row (the previous month, no values).
It is **escaped against formula injection**: every cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage return is prefixed with `'` (names are administrators' text), in the CSV and the XLSX; the reader takes
that `'` off a header again, so the template re-uploads unchanged. The CSV is UTF-8 **with a BOM** so that a spreadsheet opens umlauts. The file name comes from the service's abbreviation
(`<abbreviation>-import-template.csv`), never from free text. A service with no KPI set is 422.

## Which indicator a name means (`resolveIndicatorRef`)

[`resolveIndicatorRef(choices, reference)`](service/names.ts) is the one function that turns what a person or a program calls an indicator into the id of
an indicator of the service's effective KPI set: an **id** of a choice, else a **name without case** (spaces around it ignored, composed and decomposed
letters the same) that exactly one choice has. An empty or non-text reference, a name that no choice has (a real indicator the service does not report
included) and a name that two choices have (the database allows names that differ only in a composed or decomposed letter) are problems whose sentence never
repeats the input. `POST /api/v1/measurements` uses it per item and `GET /api/v1/measurements` per `indicators` value; the file adapters of sprint 3 use it
per column header. It is exported from `public.ts` with `IndicatorChoice`.

## The trusted reads of `kpi.framework`

`upsertBatch` and the reads need the effective KPI set with the value type, unit and bounds of each indicator, and the name, IRI and value type of an
indicator the service has dropped. `kpi.framework` offers two additive, trusted reads for that (`effectiveIndicatorsAsSystem(serviceId)` and
`indicatorsByIdAsSystem(ids)`, M10 sprint 2): they check **no permission** and name no caller, and return descriptive fields only. This module calls them
**after** its own check, so a token needs the scopes of `kpi.ingestion` and none of `kpi.framework`. It reads no table of another module.

## Events

| Event                    | Payload                                                                                                                                                                                |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `measurement.recorded@1` | `{ serviceId, runId \| null, periods: string[] (the last days of the months whose values changed, at most 120), inserted, updated, actorId \| null }`. Never a value, a name or a file |

Emitted once per batch that changed something, inside the batch's transaction; not for an unchanged batch or a dry run. A test walks the
schema and fails on a field that could carry a value (`service/event.test.ts`). `kpi.impact` (M12) listens.

## Contributions to other modules

- **`kpi.indicatorUsage`** (registry of `kpi.framework`): `{ module: 'kpi.ingestion', what: 'measurements', count(indicatorId) }`. The delete of an
  indicator that has measurements is 409 naming `kpi.ingestion (n measurements)`; the `restrict` key is the last guard.
- **`authz.resourcePolicy`** for the resource type `service`: the policy above.

## Tests

Pure functions are table-driven. `upsertBatch` runs against real Postgres with a denied case per caller class (`service/access.test.ts`, tagged
`[ASVS-8.2.1]` and `[ASVS-8.3.1]`), a rollback case (a failing outbox insert and a failing second statement leave no row), "the same month twice
updates and never duplicates", the constraints, the event and the in-use hook, and `defect-06.measurements-upsert.test.ts` (never weaken or delete
it). The clock of the module is injected (`createKpiIngestionModule({ clock })`; the harness moves it with `s.clock.set(date)`), so no test
depends on the date it runs on. Factories: `makeMeasurement` in `packages/testing`.

The reads and the name resolution (sprint 2): `service/names.test.ts` (table-driven), `service/reads.test.ts` and `service/by-name.test.ts` against real
Postgres (the denied cases, the count per filter, the order across pages, a 422 naming each bad parameter, nothing from another service, the rollback). The
routes go through the whole pipeline in `apps/server/src/measurements.contract.test.ts` (the harness of `packages/testing` for both v1 routes, the CSRF
check on a cookie tagged `[ASVS-7.2.1]`, the preflight, the body limit, a batch of 500 under the rate limiter, a form-like submission that gives the same
rows as the API), `measurements-routes.test.ts` (the internal reads), `defect-06.v1-measurements.test.ts` (never weaken or delete it) and the rows of
`defect-01.privilege-escalation.test.ts`.

## Not in this module yet

The Data Submission page (sprint 4) and the reporting reminder (sprint 5). Deleting or correcting a measurement other than by an upsert is out of scope for M10.
