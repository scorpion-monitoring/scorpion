# migrate-legacy

The one-time migration from the legacy application in use (`ipk-bit/scorpion`: FastAPI, Neo4j 3.5, InfluxDB 2.7,
Keycloak) into a new instance. It reads the legacy **REST API** into a snapshot of files, never a legacy database, and
writes only through the new modules' services. The design is [ADR-0052](../../docs/adr/0052-legacy-migration-snapshot-and-actor.md);
the scope and the decisions are the [M13 sprint plan](../../docs/m13-sprint-plan.md).

It is a workspace package (`@scorpion/migrate-legacy`, private), not a module, and it is in no image. Run it from the
repository root:

```bash
pnpm migrate-legacy <command>
```

The script loads `.env` from the repository root, as `pnpm dev` does; a variable exported in the shell wins over the
file.

## Commands

### `fetch --from <legacy base URL> --out <dir>`

Reads the legacy API into a new snapshot directory. **GET requests only**: nothing on the legacy side changes.

- `--from` is everything before `/api/v1`, the legacy `PREFIX` included (`https://legacy.example.org/scorpion`). It
  must not hold credentials, a query or a fragment.
- **The key** is the API key of a legacy **administrator**, in the environment variable `LEGACY_API_KEY` (sent as
  `X-API-Key`). It is never an argument, a log line or a file. Set it without echo or shell history:

  ```bash
  read -rs LEGACY_API_KEY && export LEGACY_API_KEY
  pnpm migrate-legacy fetch --from 'https://legacy.example.org/scorpion' --out ~/m13/snapshot
  unset LEGACY_API_KEY
  ```

- The first request is `GET /aai/users`: a refused key stops the fetch there (401), and so does the key of an account
  that is not an administrator (the legacy route then answers an empty list).
- 429, 5xx, a lost connection and a timeout are retried five times with a doubling wait (1 s first); any other answer
  stops the fetch.
- `--out` must be a new or empty directory **outside the repository**. The files are written with mode 0600 in a
  directory of mode 0700. The manifest is written last, so a fetch that stopped halfway leaves nothing that a command
  reads.

Two quirks of the legacy measurements route are handled: its `start` defaults to 2022-01-01, so the fetch asks from
`1900-01-01T00:00:00Z` (and up to 2100); and it pages each InfluxDB series on its own and counts only the first, so the
fetch asks for one page of 100 000 time points and then reads the second page, which must be empty.

### `discover <snapshot> [--measurements <S3 backup dir>] [--json]`

Summarises a snapshot as counts, spellings and abbreviations: what the new rules refuse, consortia given by name or by
abbreviation, dates off the first of a month, months with several points, months missing inside a KPI history,
services whose answer shows a second InfluxDB series, and (with `--measurements`) the API against the S3 backups. It
**names no person**: no username, address or source URL appears in it, so its counts can go into the plan.

### `plan <snapshot> --out <mapping.json>`

Writes a first mapping file for the snapshot with every gap marked: a `null` where a value is needed (the thematic
category of each KPI, the abbreviation of a consortium, a spelling that is not a vocabulary key), and a line in `open`
that says what to decide. It reads the vocabularies of the target and its configured OIDC providers, so it needs
`DATABASE_URL` too. With exactly one OIDC provider configured in the target it writes that id as `oidcProvider`. The file
is written with mode 0600, outside the repository, and never over an existing one.

### `run <snapshot> --mapping <file> --report <dir> [--dry-run] [--yes] [--keep-account] [--skip-users]`

Everything the legacy data holds, in dependency order, through the services as the account `legacy-migration`:

1. **Providers, consortia and services** (their consortia, stage and licence). Services stay private (decision 8).
2. **KPIs**: indicators (value type `integer`; the thematic category and unit from the mapping), KPI sets from the legacy
   categories with the necessity of each row (a row with none takes `missingNecessity`, `mandatory`: decision 6), each
   service's set, its additional KPIs, and every KPI that has a value for the service and is not in its set, as an
   **optional** extra (decision 9).
3. **Users and roles**: an account per legacy user that its owner **claims** at their first sign-in (below), active, with
   the role `user`. A legacy administrator gets `user` too and is reported (`user.admin-by-hand`); grant Admin by hand
   after they have signed in. The username is lower-cased and made to fit `^[a-z0-9_-]{3,31}$`; a collision gets a suffix
   (`-2`). An address that is not one, or that two users share, is reported and the user is not migrated (the mapping can
   give another).
4. **Memberships**: an approved legacy membership is a request **by the user** decided **by the migration account**; a
   pending request stays a request (at most 10 per user).
5. **Measurements**, below.

- **`--skip-users`** leaves out steps 3 and 4 (users, roles, memberships); `oidcProvider` is not needed then. A later run
  without the flag adds the users and memberships; nothing else changes.
- It needs `DATABASE_URL` and `SECRETS_KEY` of the new instance, **migrated** (`pnpm scorpion migrate`): the tool never
  migrates, and refuses a database with pending migrations. It names the target database (host, port, name) first.
- `--dry-run` reads the target and applies the modules' rules, and writes nothing to the database, not even the account.
  What it cannot read yet (a service, an indicator or the account that does not exist) is checked by the transform's rules
  only, and the report counts those measurement values as `unchecked`. Run the dry run again after a first run for the
  full check.
- A run that writes needs `--yes`; without it the tool says whether the target is empty and stops. It also stops, before
  writing anything, while the mapping has a gap that a run cannot do without (a KPI with no thematic category).
- **The migration account.** It writes as `legacy-migration`, created on the first run like `create-admin` makes an
  administrator (a random password nobody knows). An existing active account of that name is used as it is; without Admin,
  the first write is refused and the run stops with nothing written. **At the end of a run the account is deactivated**, so
  nobody can use it; `--keep-account` leaves it for a rehearsal. Nothing reactivates an account, so the next run uses
  `legacy-migration-2`, then `-3`. The last-Admin rule applies: no migrated user is an administrator, so run
  `scorpion create-admin` before the migration; without another active administrator the account stays active and the
  report says so.
- **Idempotent** by natural keys: an organisation by its type and abbreviation, a service by its slug, an indicator and a KPI
  set by name, a user by the address, a membership by user and provider, a measurement by service, KPI and month
  (`upsertBatch`). What exists and matches is kept; what differs is updated (organisations, services) or **kept as it is and
  reported** (KPIs, sets, a service's set): they are edited after the first run, and a repeated run must not undo it. A
  membership that was rejected or ended after the first run is never reopened. Rows of a set and extras of a service that are
  missing are added. A second run over the same snapshot reports "kept" for everything; a run stopped halfway is finished by
  running it again.
- A record the services refuse is reported and the run goes on; a refusal of the account itself stops it.
- **Mail.** The membership service queues its mails and inbox items as for any request (a request mails the managers and the
  administrators, a decision mails the user). The tool starts no worker, so they stay queued until the instance's worker
  runs. Keep the mail transport at `none` (Settings) until the announcement, or the users get "membership approved" before it.

**Claiming an account** ([ADR-0053](../../docs/adr/0053-migrated-accounts-are-claimed-at-the-first-sign-in.md)): the
legacy API gives no OIDC subject, so no identity is migrated. Each account is created with no way to sign in and an open
claim: the provider (`oidcProvider`, the id under "Sign-in providers" in the new instance; with exactly one configured it
is not needed), the legacy username, and an end (`claimDays`, default 90, counted from the run that created it). The
owner's first sign-in at that provider claims the account when the provider sends the same address as verified and the
legacy username as `preferred_username` (both without case); the person is then signed in to their old account with its
memberships. Otherwise nothing is linked (the instance's usual answer for an address it knows). The provider need not be
configured when the tool runs; claims wait until it is, and the report says so. A second run keeps an account whether its
claim is open or was used.

**Measurements** (plan §3): one value per service, KPI and month.

- A point is in the month of its instant (UTC); the new application stores the last day of that month. Several points of
  one KPI in one month: the latest instant wins, for the same instant the later point of the file; the others are dropped
  (reported).
- A point before 1900, in a month after the current one, or with a date that does not parse is dropped (reported).
- **Decision 13:** the legacy API leaves out every value of 0, so a month missing between a KPI's first and last point of a
  service is written as `0` (reported per service and KPI). `"fillMissingMonths": false` in the mapping leaves them empty.
  Nothing is written before the first or after the last point.
- Batches of at most 120 distinct months (and 25 000 rows) per service; each batch is checked with `dryRun` first, the rows
  the service refuses are reported and left out, and the rest is written with `source: legacy-migration`.
- A value of a service or a KPI that is not migrated is dropped (reported). In the counts, `measurement` counts **values**:
  read = the points of the snapshot, created = inserted (zeros filled included), kept = unchanged, changed = updated,
  merged = points that shared a month, dropped = dropped points, refused values and values of services not migrated.

### `compare <snapshot> --mapping <file> --report <dir>`

Reads the target back and checks it against the snapshot: **every value** the run writes, per service, KPI and month, and
the other records at the level the target answers cheaply. It **writes nothing** to the database and needs no account: it
uses trusted reads only (the migration account is deactivated at the end of a run). The expected state is the run's own
transform (`buildPlans`, with `transformMeasurements`), never a copy, so run it with the snapshot and the mapping of the run.
The values are read with `kpi.ingestion`'s `reads.storedValuesAsSystem`, which gives the `source` of each value, in windows
of 120 months from 1900 to the current month.

Every difference has a class and a reason:

| Class           | Reason                                           | What it means                                                                                                              |
| --------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| **expected**    | `filled-zero`                                    | a month missing between two points, written as 0 (decision 13) and found as written                                        |
|                 | `dropped-by-rule`                                | a point before 1900, in a future month or with a date that does not parse (with the rule's name)                           |
|                 | `merged-in-month`                                | a point that shared its month with a later one                                                                             |
|                 | `service-not-migrated`, `indicator-not-migrated` | the points of a service or a KPI the transform or the mapping leaves out                                                   |
| **unexplained** | `missing`                                        | a value the run writes is not in the target                                                                                |
|                 | `different-value`                                | the target holds another value, with the source `legacy-migration`                                                         |
|                 | `extra`                                          | a value with the source `legacy-migration` that the snapshot does not explain (an older snapshot, another mapping)         |
| **reported**    | `changed-after-run`, `entered-after-run`         | a value of another source (`form`, `csv`, `api`, …): a person changed or entered it after the run. Listed, never a failure |

For the records, a record the run writes and the target lacks is unexplained (a provider, consortium, service or user that
is missing, a consortium link, a set row or a service's extra KPI that is missing, a set the service should have, an
approved membership that is still a request). What a person may have changed after the run, where a repeated run keeps
what exists, is reported (another necessity, a row or extra added, another provider, a membership left or decided, a
renamed slug, an address held by another account).

**Exit code 1 when any difference is unexplained**, 0 otherwise. The output has counts only (per kind, per class and
reason, and the claims: open, claimed, expired). The report, in a new or empty directory outside the repository, mode
0600, is `report.json` and `report.md`: the snapshot and the mapping, the target database, the counts per kind, the counts
per service, and one line per unexplained or reported difference (at most 200 per service; the rest are counted). It
names services, KPIs and usernames, so it is sensitive like the run's.

**What it does not compare:**

- The fields of a record beyond its key: names, descriptions, stages and licences of services, organisation names, and the
  value type, thematic category, unit and description of indicators.
- **An indicator** is found by its name among the KPIs and values of the migrated services; there is no trusted read by
  slug, so one that no migrated service has is counted `unchecked`. A KPI set is checked through the services that have it
  (its rows and their necessities); a set no migrated service has is `unchecked`, and its name, slug and RIMO category are
  not compared. A renamed indicator shows its values as `missing` and `extra`.
- **Roles** (every migrated account has `user`; Admin is granted by hand) and the end of a claim.
- **Memberships of users that are not migrated** (`unchecked`), and the services, users and values of the target that the
  snapshot does not name.
- A value refused by the service during the run (`measurement.rejected` in the run's report) is `missing`: fix the cause and
  run again.

### `users <snapshot> --mapping <file> --out <file>`

Writes the users the target holds from this snapshot, one `username<TAB>address<TAB>claim<TAB>legacy-admin` per line after a
`#` header (`claim`: `open`, `claimed` or `expired`; `legacy-admin`: `yes` or `no`), for the mail that announces the move
(sign in at the provider with the same address; create a new token, since the legacy API cannot say who holds a key) and
for granting Admin to the legacy administrators once they have claimed. A user is listed only when the target has the
account the migration created, so nobody is mailed about a sign-in that cannot work. The file holds personal data: mode
0600, outside the repository, never over an existing file. No address is printed; the output gives counts only.

### The mapping

```json
{
  "format": "scorpion-legacy-mapping/1",
  "providers": {
    "<legacy abbreviation>": {
      "abbreviation": "New-Abbr",
      "name": "…",
      "type": "consortium",
      "drop": false
    }
  },
  "consortia": { "<legacy name>": { "abbreviation": "ABC" } },
  "services": { "<legacy abbreviation>": { "slug": "my-slug", "stage": "DEV", "drop": false } },
  "stages": { "<legacy spelling>": "PROD" },
  "missingStage": "PROD",
  "licences": { "<legacy spelling>": "MIT" },
  "oidcProvider": "ls-login",
  "claimDays": 90,
  "indicators": {
    "<legacy KPI name>": {
      "thematic": "Usage",
      "valueType": "integer",
      "unit": "key",
      "drop": false
    }
  },
  "kpiSets": { "<legacy category>": { "rimoCategory": "key", "drop": false } },
  "necessities": { "<legacy spelling>": "mandatory" },
  "missingNecessity": "mandatory",
  "fillMissingMonths": true,
  "users": {
    "<legacy username>": { "username": "new-name", "email": "other@example.org", "drop": false }
  },
  "open": ["what plan found to decide"]
}
```

A `null` abbreviation or stage is a gap: the record is reported and not migrated. A `null` licence leaves the licence
empty. A slug that breaks the rule is derived from the abbreviation (decision 7) unless the mapping gives one.
**A `null` or missing `thematic` of a KPI that a category, a service or a measurement mentions stops a run that writes**
(the indicator cannot be created, and its values would be lost): the dry run reports it, `run --yes` refuses.

**The legacy workaround for consortia** (decision 15): the legacy application made a consortium a provider of one
service named like it. `"type": "consortium"` on a provider migrates it as a consortium; a consortium the API gives by
name takes the abbreviation of such a provider with the same name, and the two records become one (`merged`). A service
whose provider became a consortium is not migrated (a consortium cannot provide a service). `plan` suggests every
service named like its own provider: `"drop": true` for the service and `"type": "consortium"` for the provider, each
with a line in `open` to check.

### The report

`report.json` (for the tool) and `report.md` (for people) in a new or empty directory outside the repository, mode
0600: the snapshot and the mapping it read, the account (and what became of it at the end), the target database and
whether it was empty, notes for the operator, the counts per kind (read, created, kept, changed, merged, dropped), and one
line per record that was dropped, updated, or migrated with a value a rule changed, with the rule that decided it
(`provider.abbreviation-invalid`, `service.two-providers`, `indicator.thematic-open`, `user.email-duplicate`, `user.admin-by-hand`,
`measurement.gap-filled`, `service-kpis.kpi-added-optional`, `service.refused`, …). It holds names and addresses, so it is
sensitive; a key value never appears in it.

## The snapshot

```text
manifest.json                 { format, source (the base URL), fetchedAt, files: { <path>: { sha256, bytes } } }
providers.json                GET /api/v1/providers, every page
categories.json               GET /api/v1/categories
services.json                 GET /api/v1/services: one row per service and provider
indicators-by-category.json   { <category>: GET /api/v1/indicators?category= }
indicators-by-service.json    { <service>:  GET /api/v1/indicators?service= }
users.json                    GET /aai/users                (personal data)
membership-requests.json      GET /aai/requests/membership  (personal data)
measurements/<service>.json   [{ "kpi", "date": "YYYY-MM-DD HH:MM:SS+00:00", "value" }]
```

`<service>` is the abbreviation with `encodeURIComponent`. The measurement files have the shape of the maintainer's S3
backups, so one reader takes both (`--measurements` reads `<service>.json` files the same way). Every command checks
the manifest first: a file that is changed, missing or not listed is refused.

**The snapshot holds personal data** (usernames, addresses). Keep it outside the repository and delete it after the
cutover.

## What the legacy API does not give

- **Values of 0.** The measurements route leaves out every value of 0 (`if record[label]`), and the S3 backups were made
  through it, so a 0 is a missing month in both. The tool writes them back as 0 between a KPI's first and last point
  (decision 13).
- **Services without a provider or a category.** `/api/v1/services` lists only services that have both.
- **Consortium abbreviations.** The API gives the consortium's name; the mapping gives the abbreviation.
- **The OIDC subjects of users:** not needed; each account is claimed at its owner's first sign-in (ADR-0053). **Who
  holds an API key:** no key is migrated
  (decision 5); every user is told to create a scoped token.

## The runbook

The order of a migration, for a rehearsal on staging and for the cutover. Every file the steps write (the snapshot, the
mappings, the reports, the users list) holds personal data: keep it outside the repository in a directory only you can
read, for example `~/m13` (`mkdir -m 700 ~/m13`).

### 1. Prepare the new instance

1. Deploy the `full` profile and migrate the database: `pnpm scorpion migrate` (the tool never migrates).
2. **Create the first administrator before the migration:** `pnpm scorpion create-admin --username <name> --email <address>`.
   No migrated user becomes an administrator, and the migration account can only be deactivated at the end of a run while
   another active administrator exists.
3. **Configure the OIDC provider** the legacy users signed in with (decision 3: LS Login) under Settings, Sign-in
   providers, with the id the mapping uses as `oidcProvider` (for example `ls-login`), and store its client secret:
   `pnpm scorpion set-secret oidc.<id>.client-secret`. Register `<ORIGIN><BASE_PATH>/api/internal/auth/oidc/<id>/callback`
   at the provider. (The tool also runs before the provider exists; the claims then wait for it.)
4. **Set the mail transport to `none`** (Settings, Notifications, `emailTransport`), so the membership mails the run queues
   are not sent before the announcement.

`pnpm migrate-legacy` loads `.env` from the repository root; set `DATABASE_URL` and `SECRETS_KEY` of the new instance there
or in the shell. Every command names the target database first: check it.

### 2. Fetch, plan, dry run, run, compare

```bash
read -rs LEGACY_API_KEY && export LEGACY_API_KEY      # a legacy administrator's key: never an argument or a file
pnpm migrate-legacy fetch --from 'https://legacy.example.org/scorpion' --out ~/m13/snapshot
unset LEGACY_API_KEY

pnpm migrate-legacy discover ~/m13/snapshot              # counts only, for a first look
pnpm migrate-legacy plan ~/m13/snapshot --out ~/m13/mapping.json
```

3. **Edit the mapping** until `open` is decided: a thematic category for every KPI, consortium abbreviations, the stage of
   services without one (`missingStage`), the workaround services and providers `plan` suggests (decision 15), the KPI sets
   to drop. Keep each version (`mapping-2.json`, …) until the cutover; the mapping is data, not code.
4. **Dry run until it is clean** (no gap, nothing dropped that is not meant to be; read `report.md`):

   ```bash
   pnpm migrate-legacy run ~/m13/snapshot --mapping ~/m13/mapping.json --report ~/m13/report-dry --dry-run
   ```

5. **Run** (on staging add `--keep-account`, so that a later rehearsal step can still act as the account):

   ```bash
   pnpm migrate-legacy run ~/m13/snapshot --mapping ~/m13/mapping.json --report ~/m13/report-run --yes
   ```

6. **Compare**, which must be clean (exit code 0):

   ```bash
   pnpm migrate-legacy compare ~/m13/snapshot --mapping ~/m13/mapping.json --report ~/m13/compare
   ```

7. **Run again** with the same snapshot and mapping: every record must be `kept` and every value unchanged (a new report
   directory each time). A run after the account was deactivated uses `legacy-migration-2`.

On staging (Gate 3), also check the dashboard numbers of three services by hand against the legacy application.

### 3. The cutover

Decision 11: the cutover is **Gate 4's** final migration run (`implementation.md`, Gate 4). In this order:

1. Set the legacy application **read-only** (no more submissions; tell the users the day before).
2. **Final fetch** into a new snapshot directory, then `plan` only if the snapshot brings something new (otherwise reuse the
   last mapping), a dry run, the **run**, **compare** (clean), and the second run (all kept), as in step 2.
3. **Switch DNS** (or the proxy) to the new instance. The legacy application stays read-only for 30 days, then is retired.

### 4. After the run

1. **The announcement mail**, from the users list:

   ```bash
   pnpm migrate-legacy users ~/m13/snapshot --mapping ~/m13/mapping.json --out ~/m13/users.tsv
   ```

   It says: sign in at the provider (LS Login) **with the same address** as in the legacy application, within the claim's
   days (`claimDays`, default 90), and you are in your old account with your memberships; **API keys are not migrated**, so
   create a new token (scoped) in your account and replace the key in your scripts.

2. **Admin by hand:** the users marked `yes` in the `legacy-admin` column get the role `user`. Grant Admin (Administration,
   Users) once each of them has claimed (their `claim` is `claimed` in a fresh `users` list), after checking it is them.
3. **The migration account:** a run deactivates it at the end. If the report says it is still active (no other administrator
   existed, or `--keep-account`), deactivate it under Administration, Users once another administrator exists.
4. **Turn the mail back on:** start the instance's worker with the transport still at `none`, so the queued membership mails
   are marked sent without being sent (Administration, Notifications shows the queue), then set `emailTransport` to `smtp`.
5. **Delete** the snapshots, the reports, the mapping copies and the users list once the cutover is done and Gate 4 is
   passed: `rm -r ~/m13`.

### Repeat a run

A run can be repeated at any time with the same or a newer snapshot: records are found by their natural keys and kept or
updated, values by service, KPI and month. A run stopped halfway is finished by running it again. Each run needs a new
report directory, and a run after the first uses the next migration account. After a newer snapshot, run `compare` with
that snapshot: values of the older one that the newer no longer has show as `extra`.

### When an owner cannot claim

An owner whose provider sends another address or username than the legacy data, or whose claim expired, cannot claim the
account: the sign-in takes the usual path for an address the instance knows and links nothing. There is no administrator
view of the open claims yet (backlog: "Open claims for administrators"). Meanwhile an administrator helps: read the
`claim` column of `migrate-legacy users`, correct the address in the legacy data or in the mapping (`users.<name>.email`)
before the final run, or, after the cutover, have the person register an account and request their memberships again,
which their managers approve.
