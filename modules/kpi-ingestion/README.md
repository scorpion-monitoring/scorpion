# kpi.ingestion

The measurements of the instance: one value of one indicator of one service for one month, and the one way to write them. Defect 6 of
[FEATURES.md](../../docs/FEATURES.md) §5 is what it must not repeat (an insert-only submission, two code paths, an unchecked value that became
a 500 or half a batch). The decisions are in [ADR-0041](../../docs/adr/0041-measurement-model.md), the plan in
[m10-sprint-plan.md](../../docs/m10-sprint-plan.md). It builds on `kpi.framework` (the indicators, the value types, the KPIs of a service) and
on `registry.services` (a service exists, who belongs to its provider).

Status: M10 sprint 1: the tables, the pure period and value functions, `upsertBatch`, the scoped permission and its policy, the event and the
in-use contribution. There is **no route and no page yet** (sprint 2 adds the v1 and internal routes, sprint 3 the adapters, sprint 4 the page,
sprint 5 the reminder). The module is in the `full` profile only.

## Manifest

| Part         | Value                                                                                                                                                                                                                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id           | `kpi.ingestion` (package `@scorpion/kpi-ingestion`)                                                                                                                                                                                                                                                                       |
| table prefix | `kpii_` (set in the manifest; ADR-0004): `kpii_measurement`, `kpii_ingestion_run`. `kpi.framework` uses `kpif_`                                                                                                                                                                                                           |
| dependencies | `core.authz`, `kpi.framework` (the KPIs of a service, the value types, the indicator bounds, the usage registry) and `registry.services` (a service exists; who is a member of its provider). Nothing depends on it before M11. Only what the code imports is declared; the others arrive with the sprint that needs them |
| routes       | none yet                                                                                                                                                                                                                                                                                                                  |
| ui           | none yet                                                                                                                                                                                                                                                                                                                  |
| events       | emits `measurement.recorded@1` (see "Events")                                                                                                                                                                                                                                                                             |
| registries   | declares none; contributes an `authz.resourcePolicy` entry for the resource type `service` and an entry to `kpi.framework`'s registry `kpi.indicatorUsage`                                                                                                                                                                |
| settings     | none yet (the reminder's two settings arrive in sprint 5)                                                                                                                                                                                                                                                                 |
| permissions  | the service-scoped `kpi.ingestion.measurement.submit` (see "Permissions"); the plain `v1.read`, `v1.write` and `measurement.read` arrive with the routes of sprint 2                                                                                                                                                      |

## The model

| Table                | Holds                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kpii_measurement`   | `id` (UUIDv7), `service_id` (a **plain column**: no foreign key to `svc_service`), `indicator_id` (`kpif_indicator`, **restrict**), `period` (a date, **the last day of its month**), `value_numeric` (`numeric`, finite) **or** `value_text` (1 to 4 000 characters), `source` (the adapter id; `api` for v1), `run_id` (`kpii_ingestion_run`, `set null`), audit columns. **Unique `(service_id, indicator_id, period)`** |
| `kpii_ingestion_run` | `id`, `service_id`, `adapter`, `actor_id`, `file_name` (at most 120), `status` (`committed` or `rejected`), the four counts, `problems` (a JSON list of at most 100), `started_at`, `finished_at`. Nothing writes it before sprint 3                                                                                                                                                                                        |

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

| Step                 | What                                                                                                                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| permission           | `ctx.authz.require(actor, 'kpi.ingestion.measurement.submit', { type: 'service', id })`: Admin, or an approved member of the service's provider                                                                                            |
| the service          | exists (`registry.services/public`), else 404                                                                                                                                                                                              |
| the batch            | a list of 1 to 5 000 rows covering at most 120 distinct months, a `source` of lower-case letters, digits and `-`, a `runId` that is an id: else 422 on `rows`, `source` or `runId`                                                         |
| each row             | `indicator` is in the service's **effective KPI set now** (`serviceKpis.get`), `period` is valid and not after the current month, `value` is what the indicator's type and bounds accept (`valueType.schema({ min, max })`); no other keys |
| the batch as a whole | the same indicator and month twice is refused on the later row (`rows[j].period`, naming `rows[i]`), never "last wins"                                                                                                                     |
| a bad row            | **one 422 naming every bad path** (`rows[3].value`, at most 100; the message says how many), nothing written, no event. No message repeats a value, a name or a cell                                                                       |
| the write            | one transaction, one `insert … on conflict (service_id, indicator_id, period) do update … where the value differs` per 1 000 rows (sorted by indicator and period, so concurrent batches do not wait in a circle)                          |
| counts               | `inserted`, `updated`, and `unchanged` (the same value again: not written, `updated_at` stays), from the statement itself                                                                                                                  |
| the event            | `measurement.recorded@1` once per batch **when something changed**                                                                                                                                                                         |
| `dryRun`             | everything but the write and the event; the same verdicts; a bad row is a `reject` with its problems; a batch wrong as a whole is still refused                                                                                            |

A measurement of an indicator that the service has since dropped **stays**; the reads of sprint 2 return it, and the KPI history of
`kpi.framework` (`kpisInPeriod`) tells which KPIs a month had.

An unknown run is a 422 on `runId`; an indicator deleted after its set was read is a 409. Neither is a 500.

## Permissions

| Permission                         | Grants                                                                                  | Held by                                                                                                                                                                                                                                               |
| ---------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kpi.ingestion.measurement.submit` | submit measurements for one service; **scope `service`** (ADR-0034, ADR-0036, ADR-0041) | Admin; the approved **members** of the service's provider (a manager is a member too) through this module's policy. No default role: a requested, rejected or left membership, a member of another provider, a Reviewer and a plain user hold nothing |

The policy ([service/policy.ts](service/policy.ts)) asks `registry.services/public`'s `isProviderMemberAsSystem` at **every call** and keeps
nothing, so a removal or a leave is seen at the next call. The route of sprint 2 will carry a plain permission and `upsertBatch` is the
authorization (ADR-0034). **A token** is limited by its scopes and by what its owner holds; today `upsertBatch` also reads the KPIs and the
bounds through `kpi.framework`'s checked reads, so a token needs `kpi.framework.set.read` and `kpi.framework.indicator.read` as well (ADR-0041,
decision 4; sprint 2 decides how to avoid it).

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

## Not in this module yet

The v1 and internal routes (sprint 2), the adapter registry, the CSV and XLSX parsers and the import templates (sprint 3), the Data Submission page
(sprint 4), the reporting reminder (sprint 5). Deleting or correcting a measurement other than by an upsert is out of scope for M10.
