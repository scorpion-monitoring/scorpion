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

Sprint 3 writes it as `service/xlsx-guard.ts` with the bomb, the lying bomb, a truncated file, an encrypted one and the other cases as tests (done: "Amended in sprint 3").
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

## Amended in sprint 3

What building the adapters changed or added. The plan carries the same list under "Amended in sprint 3". Where the plan and the source disagreed, the source won
and it is said here.

**Checked against the source before starting** (the plan said they exist, and they do): `upsertBatch` with `dryRun`, `normalisePeriod`, `resolveIndicatorRef`,
`kpi.framework.effectiveIndicatorsAsSystem` and the v1 routes. Three places where the plan and the source differ:

1. **The "entry in the server's `BodyLimitOverride` list" is the route's `maxBodyBytes`.** `apps/server/src/app.ts` builds the list from the routes that name
   `maxBodyBytes` (the mechanism sprint 2 used for the 3 MiB of the v1 write), so the two upload routes set `maxBodyBytes: 2 MiB + 64 KiB` and nothing under
   `apps/server/src/pipeline/**` changed. The 64 KiB is the multipart envelope; a file over 2 MiB inside it is a 422 from the service, a body over the limit is a 413 before it is read.
2. **The effective-KPI row has no IRI slug.** `effectiveIndicatorsAsSystem` returns the indicator's id, name, value type, unit, necessity and bounds, so a column is matched
   by id or by name, as `resolveIndicatorRef` does, and not by the slug of the IRI as the plan says. The template's own decoration (` (unit)` and ` *`) is taken off
   before a second try with the same function; there is no second resolver.
3. **`MAX_BATCH_ROWS` was 5 000 and is now 25 000.** The plan's limit is 5 000 data rows of a file, but `upsertBatch` counts **values**: 5 000 rows of 20 indicator columns are 100 000
   values, and a file that covers 10 years of a service with 50 KPIs (6 000 values) would have been refused. The binding limit is the 120 months a batch covers (decision 1), so the cap is
   120 months of 200 indicators. A file with more is a 422 from `upsertBatch` and is not recorded as a run.

**Decisions of the sprint**

4. **The guard came first and works** (`service/xlsx-guard.ts`; the plan's decision 1 did not need its fallback). Measured on this machine: a 61 kB bomb that inflates to 60 MB is refused from the
   central directory in **0.2 ms**; the same bomb with headers that say 1 000 bytes is refused after **223 ms** (the count passes 20 MiB inside one 4 KiB slice); a 5 000-row, 21-column workbook
   (615 kB, 3.3 MB inflated) passes in **84 ms**. It also refuses an OLE2 file (what Office writes for a password-protected workbook), more than 1 000 entries, an encrypted entry, Zip64 and a damaged
   directory, and never throws. The reader is only called with bytes that passed. `fflate` is a direct dependency, exact `0.8.3`.
5. **The reader entry is `read-excel-file/node`.** Measured with the 5 000 × 21 workbook (615 kB): `node` read it in 185 to 242 ms, `universal` in 243 to 310 ms; the event loop stalled for 5 ms with
   `node` and 6 ms with `universal` (the parse yields in both); `universal` refuses a `Buffer` (`INPUT_TYPE_NOT_SUPPORTED`) and needs a `Blob`, so the upload would be copied. The `node` entry's worker
   thread works inside the production image (`read-excel-file` and `write-excel-file` load and round-trip in 22 ms in a container of the `full` profile).
6. **Dependencies.** Runtime, exact versions: `read-excel-file` 9.3.12, `write-excel-file` 4.1.1 and `fflate` 0.8.3 (direct). Development: `fast-check` 4.10.2 (in `kpi.ingestion`, and in `kpi.framework`
   for the history property tests). New in the lockfile, nine packages: `read-excel-file`, `write-excel-file`, `fflate`, `saxen` 11.2.0, `worker-f` 0.1.20, `unzipper-esm` 0.13.3, `node-int64` 0.4.0
   (all MIT), and, development only, `fast-check` and `pure-rand` 8.4.2; `graceful-fs` 4.2.11 was already there. `pnpm audit:check` passes. **Image size, `0.11.0` against this branch, profile `full`:**
   624 448 911 bytes to 633 461 699 bytes (**+9.0 MB, +1.4%**; the compressed content size went from about 129 MB to 130 MB); the packages themselves are about 8.8 MB on disk
   (`read-excel-file` 3.5 MB, `write-excel-file` 2.9 MB, `fflate` 0.9 MB, `worker-f` 0.8 MB, `unzipper-esm` 0.5 MB, `saxen` 0.2 MB). `fast-check` is not in an image. The image still holds exactly the
   modules of its profile (`scripts/check-image-modules.ts`).
7. **Scorecard and `fast-check`.** Scorecard's Fuzzing check counts a JavaScript or TypeScript property-test library when a `.js` or `.ts` file has a line `from 'fast-check'` (or `@fast-check/ava|jest|vitest`) or
   `require('fast-check')`, per line, and only when the language is prominent in the repository. The tests import it as `import fc from 'fast-check'` on one line, so they are detected; nothing in a workflow was changed.
8. **The CSV parser** (`service/csv.ts`) has the limits of the plan (5 000 data rows, 200 columns, 4 000 characters a field), reads a record's start line for its problems, never throws, and keeps
   what it could read next to the problems. A quote is special only at the start of a field; a quote inside an unquoted field and text after a closing quote are problems. Properties (`fast-check`, 400 to 1 000 runs each):
   any table written with `writeCsv` reads back as itself for each of the three delimiters (a first field that starts with a BOM is preceded by one, because the reader strips exactly one), no input throws, and a stray or
   unterminated quote is a problem and not an exception. 5 000 rows of 21 columns (591 kB) parse and map in about **30 ms**; the same as XLSX (672 kB) in about **350 ms**.
9. **The registry `ingestion.adapter`** is declared with a Zod schema (`input: 'file' | 'values'`, `accepts`, an optional `sniff`, `parse`, an optional `template`); a bad entry stops the start naming its module and two entries with one
   id stop it too. The service never names an adapter: it asks `accepts`, `sniff` and `template`. **The content decides:** a file goes to the adapter that recognises its bytes (the named one first), so a workbook saved as `.csv`
   is read as a workbook and text named `.xlsx` as text; a file that neither recognises is a `format` problem, never a 500. A text file must be UTF-8 (a legacy encoding is the problem `encoding`).
10. **The mapping** is keyed by the 0-based column index (`{ "0": "period", "2": "<indicator id>" }`), because two columns may have the same header. Required: the period and every mandatory indicator (`MANDATORY_NECESSITY`,
    the key of sprint 2). A row with no value in any mapped column is skipped (the empty rows of an export and the template's example row); a blank mandatory cell in a row that has a value, and a row with
    a value and no period, are problems. Cells are text: a number is its shortest text, a date `YYYY-MM-DD`, a boolean is the problem `cell-type`; validity is `upsertBatch`'s verdict, so there is one rule and the
    form, CSV and XLSX give identical rows (a test writes the same data through the three and compares the rows in the database).
11. **Preview, dry run and commit parse the same bytes again.** A dry run is 200 with the verdict of each value and nothing is written or stored (row counts and events before and after are compared). A commit that finds
    anything wrong **refuses the whole file**, records a `rejected` run (counts and at most 100 problems of `{ row, column, code }`, nothing else) and answers **422** naming each `rows[r].columns[c]` and the
    run in its message. A commit that is right writes the run, the values and the event in one transaction (`upsertBatch` runs inside it as a savepoint), so a failing event leaves none of them (a test breaks the outbox).
    A request wrong as a whole (neither or both of a file and a form, an unknown adapter, an empty or oversized file, nothing to record, a service with no KPI set) is a 422 and is not recorded.
12. **A permission of its own for the write routes: `kpi.ingestion.measurement.ingest`** (the role `user`). The plan names `measurement.read` for the internal routes, but a token that may only read the grid
    could then write through preview and run (the owner still has to be allowed, ADR-0015, but the scope would mean nothing). The routes name `ingest` for the two POSTs and `read` for the history, the adapters
    and the template; the service checks the scoped `submit` for all but the list of adapters. It is the one addition to the permission list.
13. **`GET /kpi/ingestion/adapters`** was added (not in the plan's route list): the page of sprint 4 must not hard-code which files it accepts, and the registry is the only place that knows. It names `measurement.read` and
    says nothing about any service.
14. **The body is `multipart/form-data` or JSON on one route.** `@hono/zod-openapi` runs every declared validator when the body is `required: true`, and then refuses a multipart request against the JSON schema, so the body is
    declared `required: false` and the handler refuses a request with no body itself (422). A file is a multipart field, the mapping is JSON text in a field, and a form is JSON.
15. **The import template** is written by the adapter that has one (`write`), from rows the service has already **escaped**: every cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading `'`, in
    the CSV and in the XLSX (where a string cell is not evaluated anyway; the plan asks for both). The reader takes the `'` off a header again, so a template re-uploads unchanged. The CSV is UTF-8 with a BOM; the XLSX writes
    text cells with the format `@` so that Excel does not turn `2026-05` into a date. The header is `Name (unit)` plus ` *` for a mandatory indicator (the unit's term key: its label is a vocabulary of `core.settings`, which this module
    does not depend on yet). The example row holds the previous month and no values. The file name comes from the abbreviation.
16. **No table and no migration:** `kpii_ingestion_run` has existed since sprint 1 and holds everything the run needs. The run's times come from the injected clock.
17. **Tests added beyond the plan:** the three-way equivalence, the guard's cases, `fast-check` properties for the CSV, the walker `defect 1: the ingestion routes` in `defect-01.privilege-escalation.test.ts`, and the
    history property test of `kpi.framework` on `fast-check` (the oracle is the same; 40 generated histories).

## Amended in sprint 4

What building the Data Submission page changed or added. The plan carries the same list under "Amended in sprint 4". Where the plan and the source disagreed, the source won
and it is said here.

**Checked against the source before starting.** The routes the page talks to exist as the sprint 3 addendum says: `GET /kpi/ingestion/adapters`, `GET /kpi/ingestion/template`,
`POST /kpi/ingestion/preview`, `POST` and `GET /kpi/ingestion/runs`, `GET /kpi/ingestion/runs/{id}`, `GET /kpi/measurements` and `GET /kpi/measurements/coverage`, with the
typed client types already in `packages/contracts/src/generated/schema.ts`. Three places where the plan and the source differ:

1. **There was no "read of the catalogue filtered by the membership".** The catalogue (`GET /services`) lists every service a person may read and says nothing about who may
   submit for it (`allowedActions` and `editableFields` exist on one service only), so the picker could not be built from it. **One additive route**, `GET /kpi/ingestion/services?q=`
   (plain `kpi.ingestion.measurement.read`), and **one additive trusted read** of `registry.services`, `listForPickerAsSystem({ q, memberOf?, limit })` (the services of a search by
   name or abbreviation, or of the providers a user is an approved member of; no permission check, as every `AsSystem` read). The service asks the unscoped `submit` question once
   (`authz.can`, true for Admin, who holds every declared permission) to decide between "every service of the search" and "the services of my providers", and then asks the
   **scoped** `submit` for each row it keeps, so the list can only be shorter than the rule allows, never longer. At most 50 rows (`PICKER_LIMIT`). A plain user gets an empty list,
   a Reviewer (no role `user` in the test world) is 403. It adds no table and no permission. The walker of `defect-01` names it, and `docs/security/authorization.md` and V8 are updated.
2. **The value types carry no description of their input.** The plan wants "typed inputs from the value type (an integer step 1, a float, a percentage 0 to 100, a duration `HH-MM-SS`,
   text)" and CLAUDE.md rule 7 forbids a chain on the type's id in the page, but the registry data (`numeric`, `range`) cannot tell an integer from a decimal or a duration from text.
   **Additive:** an optional `input` descriptor on the entry of `kpi.valueType` (`{ kind: 'number' | 'text', step?: number | 'any', pattern?: string, hint?: string }`), set by the five
   seeds, answered by `GET /kpi/value-types` (internal, not public v1) and used by the page. A type without it is a number input when it is `numeric` and text otherwise, so another
   module's type still works. The descriptor never replaces `parse`: the server judges every value. A test checks that the duration's pattern accepts and refuses what `parseDuration` does.
3. **The coverage read is the list of months.** The plan says the page needs "the periods and the grid of the chosen month". There is no read of periods, and the browser's date is not to be
   relied on, so the loader asks the coverage read for **36** months (its maximum): the last is the current month by the server's clock, and the select offers exactly those. A month in the
   address that is later than the current one, or not a month, opens the current month; a month older than the 36 is opened as it is (it cannot be in the future), so an old correction is possible.

**Decisions of the sprint**

4. **The loader reads everything on the server; the browser sends nothing on arrival.** The page's loader (`ui/loaders.ts`) reads the picker's list and, for a service in the address, the
   service, the coverage, the runs, the adapters, the terms of `necessity` and `kpi.unit`, the value types and the grid. A service the person may not submit for is the API's 403, thrown
   (defect 12) and shown as the shell's error page. A month or a service is therefore a **page load** (`__data.json`), not a call to the API.
5. **Buttons, not `change` handlers.** Search, Open (the service), Show month and Check the file are buttons. A person who moves through a select with the arrow keys fires a `change` per
   key in some browsers, and each change would be a page load of nine reads; a button is one decision. Nothing is sent per keystroke (the e2e spec types in every field and counts).
6. **A file is a preview and a check, chained.** Choosing a file is one preview (the header, the first rows, the proposed mapping) and, when the mapping misses nothing, one dry run at once
   (it reports every problem of the file, including a value the type refuses, which the preview cannot judge). With something missing the person maps it and presses "Check the file". A change of
   the mapping sends nothing. The commit is enabled only while the check is for the current mapping and nothing is rejected.
7. **A refused commit is shown from the recorded run.** The 422 of a commit carries English text and the run's id in its message; the codes are in the run (`GET /kpi/ingestion/runs/{id}`), so
   the page reads them there and says them in its own words (an extra call only after a refusal, which the page tries to prevent by its check). A 422 that is about the request as a whole is read
   by its path (`form`, `file`, `serviceId`, `adapter`, `mapping`) and by "holds no values to record". Every code of `PROBLEM_MESSAGES` has a sentence in en and de (`submit.problem.<code>`);
   `ui/ui.test.ts` fails when one is missing, and when a sentence exists for a code the server no longer has.
8. **Multipart through the typed client.** `openapi-fetch` sends a `FormData` untouched and leaves the `Content-Type` (and its boundary) to the browser, so a `bodySerializer` that returns the
   `FormData` is all that is needed; there is no workaround and no hand-written URL. The template is a `GET` with `parseAs: 'blob'` and a download from an object URL, the file name taken from
   `Content-Disposition`.
9. **What the page never does.** It keeps the `File` in memory and sends the same bytes for the preview, the dry run and the commit; it sends no parsed row, stores nothing, shows a cell as the server
   cut it (64 characters) and uses no `{@html}`. It refuses an empty file and one over 2 MiB before sending (the limit is a copy of the server's constant, and a test compares them).
10. **The form is not reset by a save**, and the stored value is filled in when a month opens. After a save the page reads its data again (`refresh`, a page load), which updates the history and
    the coverage; the typed values stay because the form is keyed by service and month and not by the data. A form with unsaved values asks before the person leaves.
11. **Small changes elsewhere, all additive:** the `upload` icon in the closed icon table of `packages/contracts` (the navigation entry needed one); `MANDATORY_NECESSITY` moved to `service/necessity.ts`
    (re-exported by `reads.ts`, `public.ts` unchanged) so that the page can import the one term this module names without the service layer; `kpi.ingestion` gained `core.ui-shell` as an optional peer and
    `@scorpion/ui-kit` as a development dependency, as `kpi.framework` has them; `write-excel-file` 4.1.1 (already in the lockfile) is a development dependency of `apps/web` for the e2e spec. No runtime
    dependency was added.
12. **The history shows "You" and "A colleague", not a name.** The run holds the id of the person (sprint 3's backlog item); the page says "You" for the person's own runs, "A colleague" for the rest and "Not recorded" for none.
13. **Not shown: the bounds of a duration.** An indicator's bounds are stored in seconds, and the page has no formatter for the registry's `HH-MM-SS`; a bound is shown for number inputs only and the server still
    judges a duration (backlog).

**Calls, measured (the e2e spec, both base paths).** The browser sends **nothing for the page on arrival**: the only call a full load makes is the shell's `GET /inbox/stream` (the bell). Showing another month is one page
load and no call. A save is **1** call (`POST /kpi/ingestion/runs`) and one page load to refresh; a file chosen is **2** (`POST /kpi/ingestion/preview`, then the dry run `POST /kpi/ingestion/runs`); a mapping change **0**;
"Check the file" **1**; the commit **1**; a template **1** (`GET /kpi/ingestion/template`); typing in every field **0**. What the loader asks of the API on the server is **9** reads for a page with a service (the picker, the service,
the coverage, the runs, the adapters, two vocabularies, the value types, the grid) and 1 for a page with none. They share the bucket of the caller (the default one, a burst of 120 and 120 a minute) with the shell's own
reads, so a person who changes the month about nine times in a minute meets a 429; none was seen in the tests. Five of the nine are reference data that does not change within a visit (the adapters, the two vocabularies, the value
types, and in practice the picker's list): see the backlog.

## Amended in sprint 5

What building the reporting reminder and closing the backlog changed or added. The plan carries the same list under "Amended in sprint 5". Where the plan and the source disagreed, the source won and it is
said here.

**Checked against the source before starting.** Sprint 4 (PR #115) was merged into `dev`. What the plan names exists as described: the template `kpi.reporting-reminder` in `core.notifications` (`templates/kpi.ts`,
category `reminders`, data `{ provider, month, missing[], reportUrl }`), `registry.organisations/public`'s `listApprovedManagerIdsAsSystem`, `registry.services`' `listByOrganisationAsSystem` and
`isProviderMemberAsSystem`, `kpi.framework`'s `effectiveIndicatorsAsSystem`, and the page `/submit?service=<id>&period=YYYY-MM` (`SUBMIT_PATH`, with the month list of sprint 4). Five places where the plan and the source differ:

1. **Nothing lists the providers.** The job has to walk every provider, and no public read answers "which organisations provide a service". **One more additive trusted read**, `listProviderIdsAsSystem()` on
   `registry.services` (the distinct organisation ids in the role `provider`, by id; it names no service and no person), and the export `PROVIDER_ROLE` (the role id the policy already uses) for
   `listByOrganisationAsSystem(id, PROVIDER_ROLE)`. It goes beyond the two reads the plan's §13 names (`isProviderMemberAsSystem` and `listApprovedMemberIdsAsSystem`); it is recorded so it can be refused.
   The alternative, `listForPickerAsSystem`, is bounded to 200 rows and cannot enumerate.
2. **There is no "run now" on the job page.** Plan items 1 and 4 say the admin's "run now" (M4) is the manual trigger. The page of M4 (`/admin/system`, `GET /system/job-runs`) **lists** the runs and their
   counts and requeues dead _event_ deliveries; no route or button queues a job. Nothing was built for it (item 4 says not to build a "send now"), and the plan's statement is corrected here and in the README;
   a platform "run now" is a backlog item. The consequence for an operator: a reminder the job missed (see decision 3) is not sent until the next day the setting names.
3. **`core.identity` is a dependency.** `enqueueTemplate` takes the address the caller supplies; the module that knows people is `core.identity`, which `registry.organisations` uses for the same reason (an
   account that is not active gets nothing, an account with no address cannot be mailed). The plan's §2 names `core.settings`, `core.notifications` and `registry.organisations` but not `core.identity`. All four are declared in `package.json`
   (they were development dependencies of the harness).
4. **`kpii_reminder_sent` did not exist.** The plan's §3 names the table in the model, but sprint 1 did not create it. Migration `0001_reminder_sent.sql` (additive) adds it: `(provider_id, period)` primary key, `sent_at`,
   `recipients` (at least 1) and `services` (at least 1); `period` is the last day of the **reported** month with the same check as `kpii_measurement`; `provider_id` is a plain column.
5. **"A service of two providers" is a state of the data, not of the rules.** The seed role `provider` has `min: 1, max: 1`, but `svc_service_organisation` is unique on `(service, organisation, role)` only, the
   policy `service.member` loops over every provider row, and another module may contribute a role with a larger `max`. Decision: the reminder follows the data. Such a service is named once to **each** of its providers'
   members (each may submit for it) and counts in each provider's row; a consortium is never asked. A pure test covers it (`selectMissing`, "a service of two providers").

**Decisions of the sprint**

6. **The job.** `kpi.ingestion.reporting-reminder`, cron `0 6 * * *`, retry 3 times 10 minutes apart, timeout 15 minutes. The handler returns at once unless `reminders.enabled` is on **and** `clock().getUTCDate()` is
   `reminders.dayOfMonth`. The cron and the day check are UTC; the setting's help text and the README say so. A run on a day that is not the day, or with the switch off, writes nothing and reports `skipped`.
   **A day the job did not run (the node was down at 06:00 UTC on the 6th) sends no reminder that month**: the day check is exact, as the plan says. Running on every day from the setting's day on would make it robust, and the
   sent table makes that safe, but it would also remind a provider on the 20th of something that became missing later; that is a behaviour change for the maintainer (backlog).
7. **What is missing** is one pure function (`service/reminder-select.ts`): per service its providers, the **mandatory** indicators of its effective KPI set _now_ (`effectiveIndicatorsAsSystem`, necessity `MANDATORY_NECESSITY`) and the
   indicators that have a value for the month; a service with no KPI set has nothing mandatory; a dropped KPI is not asked for and its stored values stay (plan §11); a value of another indicator does not count. The measurements are read
   from this module's own table (the reminder never reads another module's table and never writes `kpii_measurement`; the walker of `module.test.ts` still finds one writer). `previousMonth` is pure: January asks for December of the year before.
8. **Recipients.** Approved members of the provider (`listApprovedMemberIdsAsSystem`, a new additive read: approved only, a manager included) who are **active** (`core.identity`), have an address, and for whom the module's own
   policy (`isProviderMemberAsSystem`, the rule behind `kpi.ingestion.measurement.submit`) says yes, asked at the moment of the send for each service the mail names. For the seed role the policy and the membership list agree, so the check
   cannot remove anyone today; it is there so that the mail follows the rule if the rule changes, and it costs one query per person and service (measured below). A person who turned the `reminders` category off is not mailed; `core.notifications`
   decides (`enqueueTemplate` honours the preference), and this module reads the person's language only (`notifications.locale`). An administrator who is not a member is not mailed.
9. **Once per provider and month, in one transaction.** For each provider the job inserts the `kpii_reminder_sent` row with `on conflict do nothing` and, only when the row is new, queues the mails with `enqueueTemplate`, all inside
   `ctx.db.tx()`. A second run, a retry, and a second node (a test starts four runs at once) send one mail per person; a mail the queue refuses rolls the row back, so the retry sends; a crash between the two cannot leave a row
   without its mails or mails without the row. **A provider with something missing and nobody to remind** (no member who is active, has an address and may submit) is not an error and **gets no row**, so a member who joins before
   the next run is still asked; the job counts it (`withoutRecipients`) and logs the month only. **A provider whose members all switched the category off gets its row** (it was addressed; nobody wants the mail), so it is not asked again.
   A provider with nothing missing sends nothing and writes nothing.
10. **No event.** The reminder emits no event: the job-run history of the admin page carries its counts (`providers`, `reminded`, `people`, `alreadySent`, `withoutRecipients`, `month`, or `skipped`), and nothing subscribes to a reminder.
11. **Settings.** `reminders.enabled` (default on) and `reminders.dayOfMonth` (default 6) in the module's strict settings schema, so they appear on the generic settings page. The day is an integer from 1 to 28 (every month has it); a value
    outside the range, a fraction, a text or an unknown key is **refused** by the settings service (422) and the stored values stay (tested), never clamped.
12. **The template moved, with the same key.** `kpi.reporting-reminder` is contributed by `kpi.ingestion` to `notify.template` (the pattern of `registry.membership-*` in M6) and removed from `core.notifications`, whose
    shipped-template test lost its sample and keeps the other two; the generic checks (both languages, the rules of every template, a snapshot per language, the strict schema) moved with it, and the snapshot is new because the text changed.
    The data gained `services` (the names of the services missing values, **at most 20**, required), `moreServices` (how many more, default 0), `moreMissing` (default 0) next to `missing` (the distinct mandatory indicators of the
    listed services, at most 20 shown); the old fields keep their meaning and the schema stays strict. The mail says "and 3 more." beyond a bound. It has no instance name, sender, URL or role name in the text (a test), the same
    placeholders in both languages (a test), and **never a value, a person or another provider's service** (a test walks the data schema and the rendered mail of a world that holds a distinctive value).
13. **The link** is `<ORIGIN><BASE_PATH>/submit?service=<id>&period=<YYYY-MM>`, built with `url()` (any number of base segments; tested under `/a/b/c`), and opens the page on that service and month (e2e, both base paths). **With several
    services it opens the first by name and the mail says so** ("The button opens X. Choose the other services on the page."). One link per service would be a long mail or several, the link with no service would lose the month for
    the most common case (one service), and the page's picker is one click away.
14. **Without `kpi.ingestion`** (`core-only`, `registry`) the key `kpi.reporting-reminder` **is not registered** and the category `reminders` is not listed on the preferences page; nothing in those profiles sends the mail (an unknown key is a
    `NotificationError` for any caller, a bug), and the profile starts. Tested: `notification-routes.test.ts` starts a profile without the module and asserts the key and the category are absent, and with the module and asserts both; the
    `core-only` image was built and started (ready after 4 s) and passes the module-set check.
15. **The e2e journey runs the job's body as a second node.** The real job fires at 06:00 UTC on the setting's day, which a journey cannot wait for, and the clock is the one input the module lets a caller inject.
    `apps/server/src/testing/run-reminder.ts` starts a kernel over the stack's database from the generated profile with `createKpiIngestionModule({ clock })` and runs `reminder.run()` once; the spec sets the clock to the 6th of the real
    current month so that the month the mail names is the real previous one, which the page offers whatever day the test runs on. It adds `run-reminder.ts` to the manifest importers of the lint rule (as `identity-app.ts` is), and the stack's `SECRETS_KEY`
    to the stack info. It is not a command of the image, nothing imports it, and it is **not** a "send now" for operators.

**Measurements (sprint 5, this machine).** A virtual AMD EPYC with 14 vCPUs and 31 GB of memory, Linux 7.0, Node 24.21, PostgreSQL 16 (the `postgres:16-alpine` image through Testcontainers, default settings, the same machine running the test), the
module over real Postgres without HTTP unless said; times are medians of 5 runs (3 for 24 000 rows). One service with 200 indicators (20 mandatory) and all values integers. The throwaway scripts were not committed.

| What                                                                           | Result                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `upsertBatch`, 1 row                                                           | insert 14.7 ms, unchanged 12.5 ms, update 14.3 ms, dry run 11.3 ms                                                                                                                                                                                     |
| `upsertBatch`, 500 rows (the API's cap)                                        | insert 73.8 ms, unchanged 75.2 ms, update 83.8 ms, dry run 22.0 ms                                                                                                                                                                                     |
| `upsertBatch`, 5 000 rows                                                      | insert 659 ms, unchanged 578 ms, update 660 ms, dry run 78 ms                                                                                                                                                                                          |
| `upsertBatch`, 24 000 rows (120 months of 200 indicators: the ceiling)         | insert 3.29 s, unchanged 2.71 s, update 3.30 s, dry run 372 ms                                                                                                                                                                                         |
| a 5 000-row file, 21 columns                                                   | CSV 523 543 bytes, XLSX 388 873 bytes                                                                                                                                                                                                                  |
| preview of that file (the service call: parse, map, first 20 rows)             | CSV 21.7 ms, XLSX 221.9 ms (the guard and the reader in a worker thread)                                                                                                                                                                               |
| dry run of that file                                                           | refused: 422 `rows`: "must hold at most 25000 measurements" (5 000 rows of 20 columns are 100 000 values), CSV 40 ms, XLSX 253 ms; the page shows its general sentence "The request was not accepted. Check the file and try again." (see the backlog) |
| a file the batch accepts                                                       | 72 rows of 20 columns (1 440 values, 5 131 bytes) dry run 30.9 ms; 120 rows of 20 columns (2 400 values) 51.0 ms                                                                                                                                       |
| `GET /api/v1/measurements`, 49 980 rows of one service, through the pipeline   | first page (100 rows) 56 ms, middle page 86 ms, **last page 111 ms**, 10 rows 53 ms; one indicator's 1 190 rows 40 ms; a 12-month window 42 ms; 5 indicators over 2 years 39 ms (medians of 7, token auth with no cache, audit on)                     |
| table `kpii_measurement`                                                       | **288 KiB per 1 000 rows** (heap 123 KiB, indexes 165 KiB: the primary key, the unique series key and three more); 14.1 MiB at 49 980 rows                                                                                                             |
| image `full` against `0.11.0-full`                                             | 624 440 719 bytes (rebuilt from the tag `v0.11.0`; sprint 3 recorded 624 448 911) to 634 120 939: **+9 680 220 bytes (+1.55%)**; sprint 3's +9.0 MB plus 0.7 MB for the page, the reminder and the template                                            |
| the reminder, one run                                                          | 1 provider, 50 services, 5 members: 0.59 s; 1 provider, 200 services, 20 members: 5.1 s (4 000 policy checks); 20 providers of 10 services and 5 members: 2.2 s                                                                                        |
| a member changing the month under the default limits (burst 120, 120 a minute) | **7 changes in a row, then the page fails** (the month select is gone): a page load makes the 9 loader reads of the server plus the shell's own, about 13 requests of the caller's bucket; the sustained rate is about 9 loads a minute                |

What the numbers say: the write is about 0.13 ms per row (a 500-row API call is 74 ms, a 5 000-row file 0.66 s), and the unchanged case costs nearly as much as an insert, so the time is in building and running the statement,
not in the writes (not profiled); no limit needs to change. The read at 50 000 rows is fast enough for a series, and a deep page costs about twice the first. A thousand measurements are under 0.3 MB with their indexes. The call counts
of the page are in sprint 4's addendum and were measured again (see the backlog).
