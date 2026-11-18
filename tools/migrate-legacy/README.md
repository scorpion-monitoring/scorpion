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

Writes a first mapping file for the snapshot with every gap marked: a `null` where a value is needed, and a line in
`open` that says what to decide. It reads the stage keys of the target, so it needs `DATABASE_URL` too. The file is
written with mode 0600, outside the repository, and never over an existing one.

### `run <snapshot> --mapping <file> --report <dir> [--dry-run] [--yes]`

The registry part: providers, consortia (from the services' links) and services with their provider, consortia, stage
and licence. Services stay private (decision 8).

- It needs `DATABASE_URL` and `SECRETS_KEY` of the new instance, **migrated** (`pnpm scorpion migrate`): the tool never
  migrates, and refuses a database with pending migrations. It names the target database (host, port, name) first.
- `--dry-run` reads the target and applies the modules' rules, and writes nothing to the database, not even the account.
- A run that writes needs `--yes`; without it the tool says whether the target is empty and stops.
- It writes as the account `legacy-migration`, created on the first run like `create-admin` makes an administrator (a
  random password nobody knows). An existing account of that name is used as it is; without Admin, the first write is
  refused and the run stops with nothing written.
- **Idempotent:** an organisation is found by its type and abbreviation, a service by its slug. What exists and matches
  is kept, what differs is updated. A second run over the same snapshot reports "kept" for everything; a run stopped
  halfway is finished by running it again.
- A record the services refuse is reported and the run goes on; a refusal of the account itself stops it.

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
  "open": ["what plan found to decide"]
}
```

A `null` abbreviation or stage is a gap: the record is reported and not migrated. A `null` licence leaves the licence
empty. A slug that breaks the rule is derived from the abbreviation (decision 7) unless the mapping gives one.

**The legacy workaround for consortia** (decision 15): the legacy application made a consortium a provider of one
service named like it. `"type": "consortium"` on a provider migrates it as a consortium; a consortium the API gives by
name takes the abbreviation of such a provider with the same name, and the two records become one (`merged`). A service
whose provider became a consortium is not migrated (a consortium cannot provide a service). `plan` suggests every
service named like its own provider: `"drop": true` for the service and `"type": "consortium"` for the provider, each
with a line in `open` to check.

### The report

`report.json` (for the tool) and `report.md` (for people) in a new or empty directory outside the repository, mode
0600: the snapshot and the mapping it read, the account, the target database and whether it was empty, the counts per
kind (read, created, kept, changed, merged, dropped), and one line per record that was dropped, updated, or migrated with a value
a rule changed, with the rule that decided it (`provider.abbreviation-invalid`, `service.two-providers`,
`service.slug-derived`, `service.stage.missing-mapped`, `service.licence.not-spdx`, `service.refused`, …).

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
  through it, so a 0 is a missing month in both. `discover` counts these months; what sprint 2 writes for them is the
  plan's decision 13.
- **Services without a provider or a category.** `/api/v1/services` lists only services that have both.
- **Consortium abbreviations.** The API gives the consortium's name; the mapping gives the abbreviation.
- **The OIDC subjects of users and who holds an API key** (sprint 2; the plan's decisions 12 and 5).

## Not yet

`run` migrates the registry only. Sprint 2 of M13 adds the KPI framework, measurements, users, roles and memberships; sprint 3 adds `compare` and the
runbook of the cutover.
