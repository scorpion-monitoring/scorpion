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

## Not yet

Sprint 3 of M13 adds `compare` (every migrated value against the snapshot) and the runbook of the cutover.
