# kpi.ingestion

The measurements of the instance: one value of one indicator of one service for one month, and the one way to write them. Defect 6 of
[FEATURES.md](../../docs/FEATURES.md) §5 is what it must not repeat (an insert-only submission, two code paths, an unchecked value that became
a 500 or half a batch). The decisions are in [ADR-0041](../../docs/adr/0041-measurement-model.md), the plan in
[m10-sprint-plan.md](../../docs/m10-sprint-plan.md). It builds on `kpi.framework` (the indicators, the value types, the KPIs of a service) and
on `registry.services` (a service exists, who belongs to its provider).

Status: M10 sprint 5: the tables, the pure period, value and name functions, `upsertBatch` and `upsertByName`, the scoped permission and its policy, the
event, the in-use contribution, the two v1 routes and the two internal reads (sprints 1 and 2), and now the registry `ingestion.adapter` with the form, CSV/TSV and
XLSX adapters, preview, dry run and commit, the run history and the import templates (sprint 3), and the Data Submission page `/submit` with its picker read (sprint 4).
Sprint 5 adds the reporting reminder: a daily job, the table that makes it send once, two settings, and the mail template, which moved here from `core.notifications`. The module is in the `full` profile only.

## Manifest

| Part         | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id           | `kpi.ingestion` (package `@scorpion/kpi-ingestion`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| table prefix | `kpii_` (set in the manifest; ADR-0004): `kpii_measurement`, `kpii_ingestion_run`, `kpii_reminder_sent`. `kpi.framework` uses `kpif_`                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| dependencies | `core.authz`, `kpi.framework` (the effective KPI set and the indicators through trusted reads, the value types, the usage registry), `registry.services` (a service exists; who is a member of its provider; the providers and their services), and, since sprint 5, `core.settings` (the reminder's settings and a person's language), `core.notifications` (the queue and the template registry), `core.identity` (whether an account is active and its address) and `registry.organisations` (the approved members of a provider). Nothing depends on it before M11. Only what the code imports is declared |
| routes       | `GET` and `POST /api/v1/measurements` (the public API); internal: `GET /kpi/measurements`, `GET /kpi/measurements/coverage`, `POST /kpi/ingestion/preview`, `POST` and `GET /kpi/ingestion/runs`, `GET /kpi/ingestion/runs/{id}`, `GET /kpi/ingestion/adapters`, `GET /kpi/ingestion/services`, `GET /kpi/ingestion/template`; see "Routes"                                                                                                                                                                                                                                                                    |
| ui           | `./ui`: the page `/submit` (the Data Submission page) through the registry `ui.routes`, one `ui.nav` entry "Data Submission" in the Main section; `core.ui-shell` is an optional peer (see "The Data Submission page")                                                                                                                                                                                                                                                                                                                                                                                         |
| jobs         | `kpi.ingestion.reporting-reminder`, daily at 06:00 UTC (see "The reporting reminder")                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| templates    | `kpi.reporting-reminder` (en, de), category `reminders`: moved here from `core.notifications` with the same key                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| events       | emits `measurement.recorded@1` (see "Events")                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| registries   | declares `ingestion.adapter` (see "Adapters") and contributes its three entries; contributes an `authz.resourcePolicy` entry for the resource type `service` and an entry to `kpi.framework`'s registry `kpi.indicatorUsage`                                                                                                                                                                                                                                                                                                                                                                                   |
| settings     | `reminders.enabled` and `reminders.dayOfMonth` (see "The reporting reminder")                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| permissions  | the service-scoped `kpi.ingestion.measurement.submit` and the plain `kpi.ingestion.v1.read`, `kpi.ingestion.v1.write`, `kpi.ingestion.measurement.read` and `kpi.ingestion.measurement.ingest`; the role `user` holds the four plain ones (see "Permissions")                                                                                                                                                                                                                                                                                                                                                  |

## The model

| Table                | Holds                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kpii_measurement`   | `id` (UUIDv7), `service_id` (a **plain column**: no foreign key to `svc_service`), `indicator_id` (`kpif_indicator`, **restrict**), `period` (a date, **the last day of its month**), `value_numeric` (`numeric`, finite) **or** `value_text` (1 to 4 000 characters), `source` (the adapter id; `api` for v1), `run_id` (`kpii_ingestion_run`, `set null`), audit columns. **Unique `(service_id, indicator_id, period)`** |
| `kpii_ingestion_run` | `id`, `service_id`, `adapter`, `actor_id`, `file_name` (at most 120), `status` (`committed` or `rejected`), the four counts, `problems` (a JSON list of at most 100), `started_at`, `finished_at`. Written by `ingestion.run` (see "Runs"); a dry run is never stored                                                                                                                                                       |
| `kpii_reminder_sent` | `(provider_id, period)` (the primary key; `provider_id` is a **plain column**, `period` the last day of the **reported** month), `sent_at`, `recipients` (how many people the mails were addressed to, at least 1) and `services` (how many services were missing values, at least 1). Counts only: no person, no service name, no value. Written by the reminder (see "The reporting reminder")                            |

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
| `GET /kpi/ingestion/services?q=`                                   | `kpi.ingestion.measurement.read`   | The picker of the page (sprint 4): the services of the search (name or abbreviation) that the caller may submit for, by name then id, at most 50. Admin gets every service of the search, an approved member the services of their provider; each row is asked again with the scoped `submit`, so the list is never longer than the rule allows              |
| `GET /kpi/ingestion/template?service=&format=`                     | `kpi.ingestion.measurement.read`   | The import template as an attachment (`nosniff`, `no-store`); `submit` on the service                                                                                                                                                                                                                                                                        |
| `GET /kpi/measurements/coverage?service=`                          | `kpi.ingestion.measurement.read`   | The last `months` (default 12, at most 36) months, oldest first: how many effective indicators and how many mandatory ones have a value, and whether nothing mandatory is missing. The mandatory ones are those of the KPI set as it is now (the necessity term `mandatory`)                                                                                 |

A row of the time series is `{ kpi, value, date, id, indicatorId, iri, service, period, valueNumber }`: the legacy `kpi`, `value` and `date` and what is
added. `value` is the **canonical text** the legacy API returned (the value type formats it: a duration as `HH-MM-SS`, a number as a decimal) and
`valueNumber` the number (a duration in seconds) or `null` for text. A row never holds the id of the person who wrote it, a source, a run or a file name
(`response-fields.test.ts`). A value of an indicator the service has since dropped is still listed, and the indicator can be asked for by name.

**A trusted series read for `kpi.analytics` (M11 sprint 3).** `reads.seriesAsSystem(serviceId, indicatorIds, fromPeriod, toPeriod)` returns `{ indicatorId, period, valueNumber | null, value }` for the stored values of the months asked (both ends included, `YYYY-MM` or `YYYY-MM-DD`), oldest month first and within a month by indicator name without case, then id (the order of `reads.list`). It checks **no permission** and no route calls it: only another module's service does, after its own check (the sibling of the `AsSystem` reads of `kpi.framework`). It is bounded: at most 120 months and 200 distinct indicators, otherwise a 422 naming `fromPeriod`, `toPeriod` or `indicatorIds`. A month with no value has no point (the caller lays out its months); the values of an indicator the service has dropped are returned. A point holds no row id, person, run or source. Tested in `service/reads.test.ts`.

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

## The Data Submission page

`/submit` is one page registered through `ui.routes` (never a SvelteKit file route), with one `ui.nav` entry (`nav.submit`, "Data Submission" / "Datenmeldung") in the
Main section. Both name `kpi.ingestion.measurement.read`, which every signed-in person holds, so nobody sees a dead link; **who may report for which service is
the picker's answer**, and a person with none sees a page that says so (with a link to their organisations), no picker and no tabs. The address is the state:
`?service=<id>` opens the page on a service, `&period=YYYY-MM` on a month, `&q=` keeps a search. **The reminder of sprint 5 links to
`/submit?service=<id>&period=<YYYY-MM>`**; a month later than the server's current one, or no month at all, opens the current month, and a month older than the
36 offered is still opened for a correction.

| Part                                           | What it does                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ui/loaders.ts`                                | Runs on the server after the permission check and **throws** (defect 12): the picker's list, and for a chosen service the service, the months with their coverage (36), the grid of the month, the last runs, the adapters, the terms of `necessity` and `kpi.unit` and the value types. A service the person may not submit for is the shell's 403 page |
| `ServicePicker.svelte`                         | A search box and a select of the services the person may report for, each with a button (Search, Open): nothing is sent when the arrow keys move through the select                                                                                                                                                                                      |
| `ReportForm.svelte`, `form.ts`                 | The month (the server's months, a button to show it), the indicators grouped by necessity (the words of the vocabulary), the input the value type asks for, the unit, the bounds, the stored value filled in, the error under its field, a save that stays disabled until every mandatory indicator has a value; the form is not reset by a save         |
| `ReportFile.svelte`, `mapping.ts`, `upload.ts` | A drop zone and a button that does the same, the templates, the preview with a row of selects (what each column holds), the verdict of each value, the problems in words, a commit that is disabled while anything is rejected                                                                                                                           |
| `History.svelte`                               | The last runs and the coverage of the last 12 months, read by the loader                                                                                                                                                                                                                                                                                 |
| `problems.ts`, `messages.ts`                   | The server's problem **codes** have a sentence of their own in en and de (`submit.problem.<code>`); a test fails when a code of the closed list in `service/table.ts` has none in a language                                                                                                                                                             |

**Typed inputs come from data.** `kpi.framework`'s value types carry an optional `input` descriptor (`{ kind: 'number' | 'text', step?, pattern?, hint? }`, the seeds: integer
`step 1`, float and percentage `step any`, duration a text input with the pattern and the hint `HH-MM-SS`, text); `GET /kpi/value-types` answers it, and the page draws
the input from it with no branch on a type's id. A type with no descriptor is a number input when it is numeric, text otherwise. The bounds are the indicator's inside
the type's range. Every value is judged again by the server.

**Calls.** The loader reads everything on the server, so the browser sends nothing on arrival, and a month or a service is a page load (`__data.json`), not a call to
the API. A save is one `POST /kpi/ingestion/runs`; a file is one `POST /kpi/ingestion/preview` and one dry run (`POST /kpi/ingestion/runs`, at once when the mapping is
complete); a change of the mapping sends nothing, "Check the file" is one dry run, the commit is one `POST`, a template is one `GET`. The e2e spec counts them and
prints `[kpi-calls]` lines (see ADR-0041, "Amended in sprint 4"). The page keeps the `File` in memory only and sends the same bytes each time; it never sends parsed
rows, stores nothing and shows nothing beyond what the server returns (a cell is cut at 64 characters by the server).

**Accessibility.** Status messages are `role="status"`, an error is `role="alert"`, an error is under its field and in text (an invalid cell says "Invalid: …" as well as
being tinted), the mapping row is a row of selects, the drop zone has a button, and a button's accessible name is its visible text. axe runs in both themes on the empty
page, the form, the file preview with errors, the run result and the history. No text names a role or the instance.

## The reporting reminder

Once a month the approved members of a provider are mailed the services of that provider that still lack a value for a **mandatory** indicator of the
previous month. Plan [§9](../../docs/m10-sprint-plan.md), items 1 to 3; the decisions are in [ADR-0041](../../docs/adr/0041-measurement-model.md), "Amended in sprint 5".

**The job** `kpi.ingestion.reporting-reminder` runs **daily at 06:00 UTC** (`0 6 * * *`; retry 3 times, 10 minutes apart; timeout 15 minutes) and returns at once
unless `reminders.enabled` is on **and** today is `reminders.dayOfMonth`. "Today" is the UTC day of the module's injected clock, so the cron and the day check
are both UTC; a test moves the clock with `s.clock.set(date)` and none depends on the date it runs on. The job runs as the system: it takes no actor, and no
route reaches it. Its result in the job-run history of the admin page is counts only: `providers`, `reminded`, `people`, `alreadySent`, `withoutRecipients`, `month`,
or `skipped` (`disabled` or `not-the-day`).

| Setting                | Default | Meaning                                                                                                                                                                              |
| ---------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `reminders.enabled`    | on      | Off: the job does nothing and writes nothing.                                                                                                                                        |
| `reminders.dayOfMonth` | 6       | 1 to 28, counted in UTC (never past the 28th, so every month has the day). A value outside the range, a fraction or a text is **refused** by the settings page (422), never clamped. |

**What is missing.** The pure function [`selectMissing`](service/reminder-select.ts) takes, per service, its providers, the mandatory indicators of its **effective KPI
set now** and the indicators that have a value for the month, and answers per provider the services (by name, then id) with the mandatory indicators that have none. A
service with no KPI set has nothing mandatory, so nothing is missing. **A dropped KPI** is not asked for (the set now decides, plan §11), its measurements stay, and
a value of an indicator that is not mandatory does not stand in for one that is. `mandatory` is `MANDATORY_NECESSITY` (the one term this module names). The month is the
one before the clock's, across a year end too (January asks for December of the year before); [`previousMonth`](service/reminder-select.ts) is pure.

**A service of two providers.** The seed role `provider` of `registry.services` has `min: 1, max: 1`, but the table `svc_service_organisation` is unique on `(service, organisation, role)`
and its policy loops over every provider row, so the data model _allows_ two. The reminder follows the data: such a service is named, once, to **each** of its providers' members
(each of them may submit for it), and counts in each provider's row. It never names a service to a provider that is not one of its providers (a consortium is not asked).

**Who is mailed.** The providers come from `registry.services` (`listProviderIdsAsSystem`, added in sprint 5, and `listByOrganisationAsSystem(id, PROVIDER_ROLE)`), their members from
`registry.organisations` (`listApprovedMemberIdsAsSystem`, added in sprint 5: approved only, a manager included; a requested, rejected or left membership and another organisation's
members are not). A member is mailed only if their account is **active** (a deactivated, rejected or deleted account gets nothing; `core.notifications` does not check this, the
caller does), has an address, and **may submit now**: the module's own policy is asked (`isProviderMemberAsSystem`, the rule behind `kpi.ingestion.measurement.submit`) for each service, so
the mail names only the services the person may report for. An administrator who is not a member is not mailed (the reminder goes to the provider's own people). A person who switched the
`reminders` category off is not mailed: `core.notifications` decides (this module reads no preference; it reads the person's language, `notifications.locale`).

**Once per provider and month.** `kpii_reminder_sent` has the primary key `(provider_id, period)`. In **one transaction per provider** the job inserts the row (`on conflict do nothing`)
and, only if the row is new, queues the mails with `enqueueTemplate`. So a second run on the same day, a retry after a failed run and a second node send nothing twice, and a crash
or a refused mail leaves neither the row nor a mail (tested: two runs, four concurrent runs, a refused mail and its retry). A provider with something missing and **nobody to remind**
(no approved member who is active, has an address and may submit) is **not an error and gets no row**, so a member who joins before the next run is still asked; the job counts it
in `withoutRecipients` and logs it. A provider with nothing missing sends nothing and writes nothing. A provider whose members all switched the category off **does** get its row
(it was addressed; nobody wants the mail), so it is not asked again.

**The mail** is the template `kpi.reporting-reminder` in [templates/reporting-reminder.ts](templates/reporting-reminder.ts), contributed to `notify.template`; it moved here from
`core.notifications` with the same key (as the membership templates moved to `registry.organisations` in M6), so no stored mail changes shape. Its data is `provider` (the
organisation's name), `month` (`YYYY-MM`), `services` (the names of the services missing values, **at most 20**), `moreServices` (how many more, shown as "and 3 more."), `missing` (the
mandatory indicators without a value, each name once, at most 20 shown), `moreMissing` and `reportUrl`. English and German, with the same placeholders (a test); no instance name,
sender address, URL or role name in the text: the layout takes the instance name, contact and imprint from the branding settings, and the link is built with the instance origin and
the **base path** (`url(BASE_PATH, '/submit')`, any number of segments). The link is `/submit?service=<id>&period=<YYYY-MM>` and opens the page on that service and month
(`SUBMIT_PATH`, the page of sprint 4). **With several services the link opens the first by name and the mail says so** ("The button opens X. Choose the other services on the
page."); one link per service would be as many mails or as many buttons, and the page's picker is one click. The mail names services and indicators and **never a value, a
person or another provider's service** (a test walks the template's data and the rendered mail). The category `reminders` stays: a person switches the mail off on the notification preferences.

**In a profile without `kpi.ingestion`** (`core-only`, `registry`) the key `kpi.reporting-reminder` is **not registered** and the category `reminders` is not listed; nothing sends the
mail there, and the profile starts (checked by a test and by starting the `core-only` image).

**No "send now".** The sent table makes a manual run safe, but neither this module nor `core.audit`'s admin page has a button for it (the page lists the job runs only). To send the
reminder of a month the job did not run for, an operator waits for the next day the setting names; see the backlog ("The reminder cannot be run on demand").

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
- **`notify.template`** (registry of `core.notifications`): `kpi.reporting-reminder`, which came from `core.notifications`.

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

The reminder (sprint 5): `service/reminder-select.test.ts` (table-driven: all present, one missing, no KPI set, a dropped KPI, a service of two providers, a year end, the order),
`service/reminder.test.ts` against real Postgres (the day, `reminders.enabled`, the settings' validation, who is and is not mailed, what the mail holds and the link under a multi-segment
base path, one mail per provider and month through two runs, four concurrent runs and a refused mail and its retry, a provider with nobody to remind, the table's constraints),
`templates/reporting-reminder.test.ts` (both languages, the rules of every template, a snapshot, the bounds, no value), `registry.organisations`' and `registry.services`' tests of the two new
reads, `apps/server/src/notification-routes.test.ts` (the category with and without this module) and `apps/web/e2e/reporting-reminder.spec.ts` (the link opens the page on that service and month,
under both base paths; the job's body runs once as a second node with the clock injected, `apps/server/src/testing/run-reminder.ts`, because the real job fires at 06:00 UTC).

The page (sprint 4): the pure helpers are table-driven (`ui/form.test.ts`, `mapping.test.ts`, `problems.test.ts`, `months.test.ts`, `query.test.ts`, `adapters.test.ts`,
`upload.test.ts`), `ui/ui.test.ts` checks the two halves, the catalogues in both languages, the sentence of every problem code and that no text names a role. The picker's read
is tested against real Postgres (`service/access.test.ts`, `registry.services`' `provider-reads.test.ts`) and in `defect-01.privilege-escalation.test.ts`. The journeys are
`apps/web/e2e/data-submission.spec.ts` under both base paths.

## Not in this module yet

Deleting or correcting a measurement other than by an upsert is out of scope for M10.
