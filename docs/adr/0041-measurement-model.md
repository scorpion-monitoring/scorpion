# ADR-0041: the measurement model, the one write path, XLSX, the history of a service's KPIs, who may submit, and our own CSV parser

- Status: Accepted
- Date: 2026-10-19

## Context

M10 adds `kpi.ingestion` ([m10-sprint-plan.md](../m10-sprint-plan.md)): the first module that **writes** data through the public API, the
first with an upload that is parsed, and the first with two new runtime dependencies. Defect 6 of [FEATURES.md](../FEATURES.md) §5 is
what it must not repeat: a submission was an insert only (a second submission of a month made a second row), the form and the API had
two code paths, and an unchecked indicator or value could become a 500 or a half-written batch. M9 left two things to settle here: the
KPIs a service had in a period ([backlog.md](../backlog.md), "No history of a service's KPIs") and a way to keep an indicator with
measurements from being deleted.

This ADR records Decisions 1 to 5 of the plan as they stand after sprint 1, with the results of the two prototypes the plan asked for
before sprint 2 could start. It is amended (as the plan is, under "Amended in sprint N") when a later sprint changes one of them.

## Decision

### 1. The measurement model and the one write path

| Table                | Holds                                                                                                                                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kpii_measurement`   | one value of one indicator of one service for one month. Unique `(service_id, indicator_id, period)`; `period` is the **last day** of its month (a check); exactly one of `value_numeric` and `value_text` (a check); text 1 to 4 000; finite numbers; `source`; `run_id` |
| `kpii_ingestion_run` | what a file or a form did (counts, at most 100 problems, a bounded file name, never the content). The table exists now; the writer comes in sprint 3. A dry run is never stored                                                                                           |

- **`service_id` is a plain column.** The module holds no reference into `registry.services`' tables; the service layer asks
  `registry.services/public` whether a service exists (the pattern of `kpif_service_set`). `indicator_id` points to `kpif_indicator`, a
  declared dependency, with `restrict`; `run_id` points to the run table with `set null` (a deleted run leaves its measurements).
  Drizzle cannot name another package's table without importing its schema, which is not part of that package's `public.ts`, so the key to
  `kpif_indicator` is written by hand in the migration (the snapshot does not know it and `db:generate` never drops it); a constraint test
  proves it exists and restricts, and `module.test.ts` lists every foreign key of the module and fails on one that points anywhere else.
- **No pg enum, no list of vocabulary terms.** What a value is comes from the registry `kpi.valueType`: a `numeric` type is stored in
  `value_numeric` as a decimal, any other in `value_text`, in its **canonical** form (a duration as seconds, a percentage as a number). One pure pair,
  `toColumns` and `fromColumns`, is the only place that knows the mapping; a registry entry that returns the wrong kind or too much text is a
  422, never a failing insert.
- **`normalisePeriod(input, now)`** (pure, the clock a parameter) accepts `YYYY-MM` and `YYYY-MM-DD` (any day of the month, surrounding spaces
  ignored) and answers the last day of that month with the Gregorian leap rule (1900 had no 29 February, 2000 and 2024 did). It refuses a time
  component, another separator, a two-digit year, an impossible month or day (`2026-13`, `2026-02-30`), a month **after the current one in UTC**
  (decision 9 of the plan), and a **year before 1900**. The year floor is an addition of sprint 1: the table's `date` would take `0001-01`, and
  a measurement from before 1900 is a typo. The message names the accepted forms and never repeats the input.
- **`upsertBatch(actor, serviceId, rows, { source, runId?, dryRun? })`** is the only code that writes `kpii_measurement`: the form, the CSV
  and XLSX adapters, the internal routes, `POST /api/v1/measurements` and the migration tool of M13 call it, and a walker in
  `module.test.ts` fails when any other non-test file in `modules`, `apps`, `packages` or `tools` writes the table. A row is
  `{ indicator, period, value }` with `indicator` the indicator's **id** (resolving a name, the legacy `kpi`, belongs to the route and the adapters).
  The order of the answers is **401, 403, 404, 422**: the scoped permission first (a stranger learns nothing about which ids are services),
  then the service, then the batch.
  - Every row is checked against the effective KPI set **now** (`serviceKpis.get`), against its value type and the indicator's bounds
    (`valueType.schema({ min, max })`), and against the calendar. The same indicator and month twice in a batch is refused on the later row
    (`rows[j].period`, naming `rows[i]`); "the last one wins" does not exist. A bad row is a 422 that names **every** bad path, at most 100
    (the message says how many there were), and writes nothing. No message repeats a value, a name or a cell.
  - **All or nothing, in one transaction.** One `insert … on conflict (service_id, indicator_id, period) do update … where the value
differs` per chunk of 1 000 rows (a statement takes at most 65 535 parameters), rows sorted by `(indicator, period)` so two batches for one
    service never wait for each other in a circle. A value that did not change is not written: `updated_at` stays, and the row is counted as
    `unchanged`. `xmax = 0` tells an insert from an update, so the counts and the verdicts come from the statement and not from a second read.
  - **Limits:** at most 5 000 rows (the upload limit) and **at most 120 distinct months** per batch. The second is not in the plan: the event names
    the changed months and its schema holds 120, so a batch that spans more is refused with a message that says to split it (M13 will chunk
    its history by ten years). The alternatives were a truncated list in the event, which would make `kpi.impact` miss months, and a
    second event, which the plan's "one event per batch" excludes.
  - **A dry run** does everything except the write and the event and answers the same verdicts. It reads the stored rows and compares in memory
    (`sameColumns`: `numeric` compares by value), so it cannot disturb a concurrent writer, and a test proves that a dry run and the real run
    that follows give the same verdict for every row. A bad row is a `reject` verdict with its problems and not a 422 (the file preview of
    sprint 3 needs the rows that are good next to the ones that are not); a batch that is wrong as a whole (empty, too long, too many months, no
    permission) is refused in both modes.
  - **A foreign-key error is a 409 or a 422, never a 500:** an unknown run is 422 on `runId`; an indicator deleted after its set was read is
    409 ("nothing was recorded, try again").
- **The event `measurement.recorded@1`** is `{ serviceId, runId | null, periods[] (the last days of the months whose values changed, at most
120), inserted, updated, actorId }`. It is emitted once per batch **when something changed** and never for an unchanged batch or a dry run.
  Its schema is strict and holds no free text (a test walks its JSON Schema and fails on any field that could carry a value or a name, and
  another reads the payloads that real batches stored). `kpi.impact` (M12) listens; nothing else does.
- **The indicator in-use hook.** `kpi.framework` declares the registry `kpi.indicatorUsage` (`{ module, what, count(indicatorId) }`) and its
  indicator delete asks every entry after its own checks: an indicator with measurements is a **409 naming `kpi.ingestion` and the count**, and
  the `restrict` key stays as the last guard (a refusal by any key is a 409, not a 500). The delete already holds the row lock of the indicator
  (`for update`), so a writer that would reference it waits and fails after the commit on its own side; "a row appears between the question and
  the delete" cannot happen for a real foreign key, and the test of the 409 from the key uses a trigger that raises the same error.

### 2. XLSX: `read-excel-file` for the upload, `write-excel-file` for the template

The maintainer chose both libraries (decision 1 of the plan). The plan asked for a prototype before they enter the repository; nothing is
added to the repository in sprint 1 and the packages arrive in sprint 3. The prototype ran in a scratch directory outside the repository
(`read-excel-file` 9.3.12, `write-excel-file` 4.1.1, `fflate` 0.8.3, the registry's latest on 2026-10-19) against workbooks built by hand and
by the writer. **Result: the libraries can be used, behind a guard that the adapter must write.** The plan's fallback (no XLSX in M10) is not
needed and the sprint was not stopped.

| Case                                                                                                        | Result                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| A normal workbook written by `write-excel-file`                                                             | read back as `[["Period","Downloads"],["2026-01",12],["2026-02",15]]`; 9 to 19 ms                                                                     |
| A formula cell (`SUM`, a `HYPERLINK`, a text formula `1+1` whose cached value was changed to `CACHED-TEXT`) | the **cached value** is read (`3`, `"cached"`, `"CACHED-TEXT"`); the text formula answering `CACHED-TEXT` and not `2` shows that nothing is evaluated |
| A date cell (a date style, serial 46054)                                                                    | a JavaScript `Date` at UTC midnight (`2026-02-01T00:00:00.000Z`): the adapter turns it into `YYYY-MM-DD`                                              |
| An empty trailing row                                                                                       | dropped (`[["a","b"],[1,2]]`)                                                                                                                         |
| A truncated file; a text file; a CSV with the extension `.xlsx`                                             | `InvalidInputError` ("Couldn't unzip" or "Doesn't look like an `.xlsx` file"): a clean error to turn into a 422, never a crash                        |
| **A zip bomb of 63 kB that inflates to 60 MB**, given to the reader as it is                                | **the reader has no cap**: it ran for **60 s** and ended with `Maximum call stack size exceeded`. It does not refuse the bomb before inflating it     |
| The same bomb behind the guard below                                                                        | refused in **under 1 ms** from the central directory (`declared-too-large`)                                                                           |
| A bomb whose headers **lie** (the directory and the local header say 1 000 bytes)                           | refused after about 190 ms and about 23.6 MB of output (`inflated-too-large`) by the bounded count below                                              |

**The guard** (the "pre-scan" the plan allows) has two stages, both before the reader sees the file, and the reader is only called with
bytes that passed:

1. read the end-of-central-directory record and the central directory (no inflating): refuse a file that is not a zip, that has more than
   1 000 entries, an encrypted entry, or whose **declared** uncompressed sizes add up to more than the cap (20 MiB, the plan's limit);
2. a declared size can lie, so inflate with `fflate`'s streaming `Unzip` in slices of **4 KiB of input** (one slice inflates to at most about
   4 MB) and count the real output; stop and refuse as soon as the count passes the cap.

Sprint 3 writes it as `service/xlsx-guard.ts` with the bomb, the lying bomb, a truncated file, an encrypted one and the other cases as tests.
`fflate` is then a direct dependency of `kpi.ingestion` (it is already a dependency of both libraries; it is named in the pull request).

Things sprint 3 must know, found by the prototype:

- **The dependency tree is larger than the plan said.** `read-excel-file` 9.3.12 depends on `saxen`, `fflate`, `worker-f` and `unzipper-esm`
  (which brings `graceful-fs` and `node-int64`); `write-excel-file` 4.1.1 on `fflate`. Eight packages were installed in the scratch directory
  in all. The plan named `fflate` and `saxen`. The pull request of sprint 3 lists every one, with `pnpm audit` and the image size.
- **The `node` entry parses in a worker thread** (`worker-f/node`); the `universal` entry works on the bytes in the calling thread. Sprint 3
  chooses one and tests it; a worker isolates a slow parse from the event loop, but a bomb in a worker still allocates, which is why the guard
  comes first.
- The reader takes a `Buffer` (the upload is already in memory, at most 2 MiB); the first sheet is read unless a name is given.

### 3. The history of a service's KPIs

The measurements of a month are judged against the KPIs a service has **now**; M11 and M12 need the KPIs it **had** in that month, and that
cannot be rebuilt later. `kpi.framework` records it from sprint 1 (decision 3 of the plan):

- **`kpif_service_kpi_history`** `(service_id, valid_from)` primary key, `set_id`, `extras uuid[]`, `valid_to` (null while current),
  `changed_by`. A row is the state **from** `valid_from` (inclusive) **to** `valid_to` (exclusive). The one writer of a service's KPIs
  (`KpisWriter.write`, used by `serviceKpis.set` and by the create wizard's `store`) appends a row **in the same transaction** and closes the
  previous one, whenever the set or the extras changed. A rolled-back change leaves no row (a rollback test for both transactions).
- **Append-only, enforced by a trigger** (like `core.audit`): a delete is refused and so is every update but closing the open row once, from
  null to a time. The new row begins at the database clock and at least a microsecond after the one it closes, under the per-service advisory
  lock the writer already holds, so keys never collide and rows never overlap. A later deletion of services needs a migration that drops
  the trigger, with an ADR.
- **Backfill.** The migration gives every service that has a set or extras one open row, with `valid_from` the `updated_at` of the service's set
  row (a service with extras only starts at the migration). **History starts at the migration for what changed before it**; the README says so.
- **`kpisInPeriod(serviceId, period)`** (a trusted read on the service and so on `public.ts`: no permission check, the caller checks its own)
  answers with the state **in force at the end of the month**: two changes in one month leave the later one. It returns `{ setId, extras,
validFrom, rows }` (`rows` is the effective list of that state through the same function as today's, `effectiveOf`, so there is one rule),
  or `null` when the history holds no state for the month. Property tests compare it with an independent oracle for 40 generated
  histories at every month of the range and beyond (a seeded generator; the property-test library arrives with the CSV parser).
- **Limits, recorded:** the **rows of a set are not versioned** (a set edited later shows its new rows in every month that used it: backlog), and
  an extra whose indicator was deleted since is named in the history and dropped from `rows`.
- `measurement`'s own rule stays: a measurement of an indicator the service has since dropped **stays** and is returned by the reads.

### 4. The permission and the read rules

- **`kpi.ingestion.measurement.submit`**, scope `service` (ADR-0034, ADR-0036): **Admin and the approved members of the service's provider**
  (decision 2 of the plan; a manager is a member too). This differs from the KPIs of a service, which only managers change (M9). The
  permission belongs to no default role, so no route can name it as a pipeline check; `upsertBatch` calls `ctx.authz.require` with the service, and
  that call is the authorization (ADR-0034's design A).
- **The policy** is this module's own entry in `authz.resourcePolicy` and asks `registry.services/public` at **every call**, and keeps nothing:
  a left or removed member is refused at the next call, a demotion keeps the member, a move of the service to another provider moves the
  right. The question is the one **additive read** `isProviderMemberAsSystem(userId, serviceId)`, the sibling of `isProviderManagerAsSystem`
  (the same policy `service.member`, the permission `service.edit`); `registry.services` changes in no other way.
- **A requested, rejected or left membership, a member of another provider, a plain user, a Reviewer and an anonymous caller** are refused
  (401 for the anonymous caller, 403 for the others, also for a dry run), tested through the real authorizer and tagged `[ASVS-8.2.1]` and
  `[ASVS-8.3.1]`. A token is limited twice, by its scopes and by what its owner holds (ADR-0015).
- **Reading** (sprint 2): every holder of `kpi.ingestion.v1.read` and of the internal read, which the role `user` holds, reads every service's
  measurements, as services and KPI definitions are readable by every signed-in person (decision 4 of the plan). Never anonymous, never public.
  An answer never holds another person's id, a file name or a run.
- **Known consequence for sprint 2 (found while testing the token case).** `upsertBatch` reads the service's KPIs with `serviceKpis.get` and each
  indicator's bounds with `indicators.get`, as the plan says, and both check a **plain read permission of the actor**. For a session that is
  nothing (the role `user` holds both); for a **token** the scopes must name `kpi.ingestion.measurement.submit`, `kpi.framework.set.read` and
  `kpi.framework.indicator.read` or the call is 403 (probed: submit alone, 403; submit and set, 403; all three, 200). A write token would need
  three scopes besides `kpi.ingestion.v1.write`. The way out is for `kpi.framework` to offer a trusted read (an `…AsSystem` read of the effective
  rows with their bounds, checked after this module's own scoped check) and for `upsertBatch` to use it; it is an additive change of
  `kpi.framework/public` and does not change this ADR's rules. **Sprint 2 decides before the route is written.** _(Decided in sprint 2: see
  "Amended in sprint 2", item 1; a token now needs `submit` and nothing of `kpi.framework`.)_

### 5. Our own CSV parser

CSV and TSV are parsed by a **pure function of our own** (`service/csv.ts`, sprint 3), with no runtime dependency (decision 5 of the plan;
`csv-parse` was rejected): RFC 4180 quoting, a BOM, CRLF, LF and CR, delimiter detection between comma, semicolon and tab, the limits of the
plan, and a problem with a line and a column instead of an exception. `fast-check` becomes a **development** dependency with it (round trip,
"no input throws", a quote in an unquoted field, an unterminated quote). Nothing of it is built in sprint 1.

## The prototype of a write through the pipeline

The plan required a throwaway `POST /api/v1/ping` through the real pipeline before sprint 2, because a cookie-authenticated write on `/api/v1`
that skipped the CSRF check would be a change to `apps/server/src/pipeline/**` (an ASVS V7 and V8 scoped path) and would need its own ADR. A
fixture module with a `post` route on `r.public('v1', …)`, a `permission` and `audit: true` was run through `createApp` with the real
authenticator, authorizer and rate limiter on real Postgres (a throwaway test, deleted, not committed):

| Request                                                       | Answer                                                    |
| ------------------------------------------------------------- | --------------------------------------------------------- |
| no credentials                                                | 401 "Authentication is required."                         |
| `Authorization: Bearer <token>` with the scope                | 200                                                       |
| `X-API-Key: <token>` with the scope                           | 200                                                       |
| a made-up token                                               | 401 "The access token is not valid."                      |
| **session cookie, no CSRF header**                            | **401 "The CSRF token is missing or wrong."**             |
| session cookie, a wrong CSRF header                           | 401 "The CSRF token is missing or wrong."                 |
| session cookie and the right `X-CSRF-Token`                   | 200 (a person on the instance's own pages)                |
| a token and a stale cookie, no CSRF header                    | 200 (a request with a token is a token request; ADR-0008) |
| a preflight `OPTIONS` from an origin that is not allow-listed | 403, no `Access-Control-Allow-*` header                   |

**The pipeline refuses a cookie write without the CSRF token on `/api/v1` as on any route**: the check is in the authenticator and covers every
method that is not safe, whatever the path. So **no change to `apps/server/src/pipeline/**` is needed** and the sprint was not stopped. Sprint 2
turns the table into tests (the cookie case tagged `[ASVS-7.2.1]`) and makes the preflight of `/api/v1/measurements` name its own methods.

## Consequences

- A measurement can be written and read through one tested path with every rule of defect 6 in place; the form, CSV, XLSX, the API and the
  migration tool cannot write it any other way (a walker proves it).
- The history adds a table and a trigger to `kpi.framework` and costs one row per change of a service's KPIs. A set whose own rows change
  is not versioned; M11's month view for a changed set is right for the set's membership at the time of the query, not at the time of the month.
- A batch spans at most 120 months, which a one-time import of old data has to respect by chunking.
- An indicator with measurements cannot be deleted: an administrator who wants to retire one deactivates its use (drops it from the sets and
  the services), and the 409 says how many measurements still name it.
- The permission design means the **service** is the authorization and the route will carry a plain permission. The matrix of
  `defect-01.privilege-escalation.test.ts` has to get a row for the routes of sprint 2 that expects 403 for a plain User.
- The XLSX libraries bring more packages than the plan said, and the reader has no inflation cap: sprint 3 must write and test the guard
  before the first upload route exists.
- A token could not submit with the scopes the plan names (see decision 4); sprint 2 resolved it first ("Amended in sprint 2", item 1).

## Amended in sprint 1

Where building changed or added to the plan. The plan carries the same list under "Amended in sprint 1".

1. A year before 1900 is refused (the plan only refused the future).
2. A batch covers at most 120 months (the event's limit made it necessary).
3. A dry run answers a bad row as a `reject` verdict and not as a 422 (the plan's sprint 3 asked for verdicts with the code; the service now provides them).
4. `upsertBatch` takes the indicator's **id**; the legacy name is resolved by the route and the adapters.
5. The foreign key to `kpif_indicator` is written by hand in the migration.
6. The dependency tree of the XLSX libraries is larger than the plan said, and a guard is required (decision 2).
7. `upsertBatch` needs three token scopes beyond the route's until `kpi.framework` offers a trusted read (decision 4).
8. `kpi.framework`'s `effectiveSet` is split into `effectiveSet` and `effectiveOf` so that the past and the present share one rule.

## Amended in sprint 2

What building the API changed or added. The plan carries the same list under "Amended in sprint 2".

1. **A token needs `submit` and nothing of `kpi.framework` (the decision of decision 4's "Known consequence").** `kpi.framework` gets one additive trusted
   read, `effectiveIndicatorsAsSystem(serviceId)` (service and `public.ts`): the effective rows of a service with the indicator id, name, value type, unit,
   necessity, source and the **bounds** (`min`, `max`), checking no permission (the `AsSystem` rule: the caller checks its own). `upsertBatch` calls it
   **after** its own scoped check and no longer calls `serviceKpis.get` or `indicators.get`. A token for `POST /api/v1/measurements` therefore names
   `kpi.ingestion.v1.write` (the route) and `kpi.ingestion.measurement.submit` (the service) and needs an owner who may submit; the three scopes of sprint 1 are
   gone. The test that named them is `access.test.ts` ("turns a token away unless it names the scope"), now tagged `[ASVS-8.2.1] [ASVS-8.3.1]` and asserting that
   `submit` alone passes the service and the two `kpi.framework` read scopes alone do not. The bounds come from a second query of the same function (the
   indicator's two columns) and not from `effectiveOf`, so the rows `serviceKpis.get` answers with are unchanged.
2. **A second trusted read was needed, for the reads: `indicatorsByIdAsSystem(ids)`.** The time series shows the name, IRI and value type of each indicator,
   in the order of the names, and a measurement of an indicator the service has since dropped stays (decision 1), so the effective set cannot name every
   indicator that is read. `kpii_measurement` has no name column and this module reads no table of another module, so `kpi.framework` offers the
   second read (name, IRI, value type and unit by id, at most 5 000 ids; the IRI needs `kpi.framework`'s `iriBase` setting, which this module cannot read).
   It is of the same kind and for the same reason as the first (additive, no permission check, descriptive fields only, called after this module's own
   check); it goes beyond "one trusted read" and is recorded here so the maintainer can say no. Nothing else was added to `kpi.framework`.
3. **The names.** `resolveIndicatorRef(choices, reference)` (`service/names.ts`, exported from `public.ts`) is the one function that turns the legacy `kpi`
   (and, in sprint 3, a column header) into an indicator id: an id of the effective set, else a name without case (surrounding spaces ignored, composed
   and decomposed letters the same) that exactly one indicator has; unknown and ambiguous are problems that never repeat the input. The database allows two
   indicators whose names differ only in a composed or decomposed letter (the unique index is `lower(name)`), so "ambiguous" is real and says to use the
   id. `upsertByName(actor, service, items)` is the service method behind `POST /api/v1/measurements`; it shares `upsertBatch`'s code, and only the **naming**
   of a problem differs (`[3].kpi`, `[3].value`, `[3].date`, and `` for the batch as a whole, instead of `rows[3].indicator`, `.value`, `.period`, `rows`). The
   shape errors Zod finds in the body keep the pipeline's own form (`0.kpi`), which the route's description says. The source is `api`.
4. **The order of the answers on the routes differs from `upsertBatch`'s, on purpose.** The route resolves the service by id or **abbreviation** before the
   scoped check (an abbreviation cannot be authorised before it is a service), so an unknown service is 422 naming `service` for anyone who may use the route.
   A service is readable by every signed-in person (ADR-0036), so naming an unknown one discloses nothing. `upsertBatch` keeps its order (401, 403, 404, 422).
   The order of the route is: 401 (no credentials), 403 (the pipeline: scope or owner lacks `kpi.ingestion.v1.write`), 422 (unknown service), 403 (the scoped
   permission), 422 (the body), 200.
5. **The body limit is 3 MiB.** The route sets `maxBodyBytes` (the existing mechanism; no change to `pipeline/**`). 500 items of the legacy shape are about
   60 kB, but a text value may be 4 000 characters, a name 200 and a date 32: 500 x (4 000 + 200 + 32 + about 40 of JSON) is 2.14 MB of plain ASCII, so the
   limit is 3 MiB; a test sends 500 values of 4 000 characters (about 2 MB, over the server-wide 1 MiB) and gets 200, and a body over the limit is 413 before
   it is read. The rate limiter counts requests, not items: a test sends three batches of 500 through a bucket of five.
6. **The preflight needed no change in `apps/server/src/pipeline/**`.** `cors()` takes one list of methods, so `app.ts` builds one `cors()` per distinct list
   (`apps/server/src/preflight.ts`) and picks by the path of the request from the registered routes: `GET, POST, OPTIONS` for `/api/v1/measurements`,
   `GET, OPTIONS` for the other v1 paths, and the methods of the whole surface for a path no route has (as before). This closes the backlog item "The preflight
   answer lists the methods v1 has overall". `cors.ts` and its tests are unchanged; `docs/security/**` changes for the notes only (V7 and V8).
7. **The CSRF prototype became tests.** A session cookie on `POST /api/v1/measurements` without `X-CSRF-Token`, with a wrong one or with another session's
   is 401 and writes nothing; with the right one it writes as the signed-in person; a token with a stale cookie works; a made-up token is 401; `X-API-Key` works
   (`measurements.contract.test.ts`, the cookie cases tagged `[ASVS-7.2.1]`).
8. **The reads.** `GET /api/v1/measurements` reads one service (`service` required: id or abbreviation). The order is month, indicator name without case, id: the
   name is not in this module's table, so the few indicators of the service are ranked in memory and the database sorts by that rank (`array_position`), month
   first, so the order holds across pages. The indicators that can be named in `indicators` are the service's effective KPIs and every indicator it has a value
   for (a real indicator unrelated to the service is 422). `start` and `stop` mean the month they name (any day of it) and may lie in the future; `start`
   after `stop` is compared by month. `value` is `valueType.format(canonical)` (the legacy text) and `valueNumber` the number; a value type that is no longer
   registered is shown as its canonical text. The internal reads share the way a value is shown (`present`) and the service check with the time series: the grid is the effective set with the
   stored value of one month, and the coverage counts, per month of the last 12 (at most 36), the effective indicators and the mandatory ones that have a value. The
   mandatory ones are those with the necessity term `mandatory` of the set **as it is now** (the key is the legacy and RIMO's `mandatoryFor`; it is the one
   place the module names a term of that vocabulary), and a month is `complete` when none of them is missing, also while nothing is mandatory.
9. **Compared with the legacy API documentation (FEATURES §3.16).** What matches: the path and the parameters `service`, `indicators`, `start`, `stop`; the row
   `{ kpi, value, date }` (kept, with additions); the envelope `{ metadata: { currentPage, pageSize, totalCount, totalPages }, result }` with 0-based pages;
   `POST` upserting `[{ kpi, value, date }]`, accepting only the service's KPIs, type-checking the values and turning `YYYY-MM` into the month end. What differs, each
   a fix of a defect in FEATURES §3.16 or a consequence of the shared rules of v1: the list is under `result`, not `data`; the order is stable across pages;
   `POST` checks that the caller may submit for the service; `pageSize` is at most 100 with a default of 100 like every v1 list (the legacy default was 1 000);
   `service` is required; an unknown service, indicator or month is a 422 naming it; a value of a month after the current one is refused; the same indicator and
   month twice in one batch is refused (never "the last one wins"). What the documentation does not say, so the choice is recorded here: the legacy format of
   `date` (an ISO date or a time stamp) and whether `value` was text or a number are not in FEATURES §3.16 and the repository holds no legacy source. `date` is
   `YYYY-MM-DD` (the month end) and `value` the canonical text, with `valueNumber` added, which keeps a client that read `value` as text working and lets a new one
   read a number. A client of the legacy API that read `data` or relied on a `pageSize` of 1 000 has to change; the changeset says so.
