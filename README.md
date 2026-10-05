# Scorpion

[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/scorpion-monitoring/scorpion/badge)](https://scorecard.dev/viewer/?uri=github.com/scorpion-monitoring/scorpion)

Scorpion is a service registry and KPI tracker for research infrastructures (de.NBI, NFDI).
This repository is the rebuild as a **modular monolith**: one server, one PostgreSQL database,
many modules. A deployment **profile** selects the modules at build time.

Status: milestone **M1** (the kernel). Modules can be declared, resolved, migrated and wired
together, but no real module exists yet, so the server serves only its probes (`/healthz`,
`/readyz`, `/metrics`) and the web app shows a placeholder page. See
[docs/implementation.md](docs/implementation.md) for the milestone plan and
[packages/kernel/README.md](packages/kernel/README.md) for the module-author guide.

## Prerequisites

- Node.js 24 LTS (`.nvmrc`)
- pnpm 10 through Corepack: `corepack enable`
- Docker Engine with the Compose plugin (dev services, Testcontainers, image builds)

## Quick start

```bash
pnpm i
pnpm dev          # Postgres + Mailpit (Docker), server on :3000, web on :5173
curl localhost:3000/readyz
```

`pnpm dev` creates `.env` from `.env.example` when it is missing, starts Postgres and Mailpit,
and runs the server (which applies pending migrations on start) and the web app.

Mailpit's web UI runs on <http://localhost:8025> (SMTP on port 1025). `pnpm dev` also runs `scorpion seed-dev-mail`, which
points the instance's mail settings at that Mailpit when none are stored yet (development only: the command refuses with
`NODE_ENV=production`, and never overwrites settings that are saved). Register an account and the welcome and administrator mails
show up there.

```bash
pnpm check        # ESLint (incl. module boundaries), Prettier, tsc -b, svelte-check
pnpm test         # Vitest over all packages (Testcontainers tests need Docker)
pnpm test --filter @scorpion/server   # one package
pnpm test:e2e     # Playwright smoke test (first: pnpm --filter @scorpion/web exec playwright install chromium)
pnpm build --profile kpi-tracker      # image scorpion:dev-kpi-tracker
```

## Profiles

A profile (`profiles/<name>.ts`) lists the modules one deployment contains. Each profile
gets its own image. To add or remove a plugin, rebuild the image and restart; modules are
never loaded at runtime ([ADR-0001](docs/adr/0001-modular-monolith-build-time-composition.md)).

| Profile           | Purpose                                                            |
| ----------------- | ------------------------------------------------------------------ |
| `full`            | Every module                                                       |
| `denbi-registry`  | de.NBI service registry with KPIs, bibliometrics and network graph |
| `nfdi-onboarding` | NFDI service onboarding with maturity assessment                   |
| `kpi-tracker`     | KPI collection and analytics                                       |

The module lists for each profile are in the comments of the profile files, and the full
matrix is in [docs/architecture.md](docs/architecture.md). Until M2 every profile's module list is
still empty.

```bash
PROFILE=kpi-tracker pnpm dev
docker build -f docker/Dockerfile --build-arg PROFILE=kpi-tracker -t scorpion:dev-kpi-tracker .
```

## Running it

The image (`scorpion:<version>-<profile>`) starts with `node apps/server/src/cli.ts start`. It is
configured through the environment; unknown or invalid values stop the start with the full list of
what is wrong, and secrets never appear in logs.

| Variable           | Default                             | Meaning                                                                                                                                                                                                  |
| ------------------ | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`     | none, required                      | PostgreSQL 16 connection URL                                                                                                                                                                             |
| `PROFILE`          | the profile of the build            | Must match the build; an image refuses another profile                                                                                                                                                   |
| `PORT`             | `3000`                              | Port to listen on                                                                                                                                                                                        |
| `BASE_PATH`        | `/`                                 | Path prefix, `/` or `/a/b` (any depth, no trailing slash)                                                                                                                                                |
| `LOG_LEVEL`        | `info`                              | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`                                                                                                                                           |
| `WORKER_MODE`      | `inline`                            | `inline`: this process also runs jobs and events; `separate`: use a worker                                                                                                                               |
| `ORIGIN`           | `http://localhost:$PORT`            | Public origin (scheme, host, port), without a path                                                                                                                                                       |
| `SECRETS_KEY`      | none, required with `core.settings` | 32 random bytes, base64 (`openssl rand -base64 32`): encrypts the stored secrets. Profiles with `core.settings` (and `core.identity`) stop with a message if it is missing; back it up with the database |
| `SECRETS_KEY_NEXT` | none                                | Only while rotating the key with `scorpion rotate-secrets` ([core.settings](modules/core-settings/README.md#rotating-the-key))                                                                           |
| `TRUSTED_PROXIES`  | none                                | Comma-separated IPs or CIDR ranges of the reverse proxies in front of the server. Only their `X-Forwarded-For` is believed, for the rate limit; with none set the socket address is used                 |

| Command                     | What it does                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| `scorpion start`            | Migrates, then serves (and runs workers when `WORKER_MODE=inline`)                          |
| `scorpion worker`           | Migrates, then runs jobs and the event dispatcher only, without HTTP                        |
| `scorpion migrate`          | Applies pending migrations of every module and exits                                        |
| `scorpion profile:generate` | Build time: composes the server for a profile                                               |
| `scorpion <command>`        | A command a module of the build contributes: `create-admin`, `set-secret`, `rotate-secrets` |

`GET /healthz` says the process is alive and never touches the database. `GET /readyz` answers 503
until the database answers and every migration is applied, and again while shutting down.
`GET /metrics` serves Prometheus metrics (process, HTTP duration by route, outbox lag, job
durations); restrict it at the proxy if the network is not trusted. On SIGTERM the server stops
accepting requests, lets running requests, jobs and event handlers finish (up to 30 s), and closes
its connections.

To try an image locally: `docker compose -f docker-compose.dev.yml --profile app up --build`.

## Repository layout

```text
apps/server      Hono server (kernel bootstrap, pipeline, CLI and worker from M1)
apps/web         SvelteKit shell
packages/*       kernel, contracts, ui-kit, integrations, testing
modules/*        one package per module (from M2)
profiles/*.ts    deployment profiles
tools/           eslint-plugin (module boundary rule), lint-fixtures, migrate-legacy (M13)
docs/            FEATURES.md, architecture.md, implementation.md, adr/, backlog.md
docker/          Dockerfile
```

## Changelog

[CHANGELOG.md](CHANGELOG.md) is generated from changesets at each release. Every pull request
adds one with `pnpm changeset`. `main` holds released code only; work happens on `feature/*`
branches from `dev`. See [CONTRIBUTING.md](CONTRIBUTING.md) for the branch and release policy.

## Further reading

- [CONTRIBUTING.md](CONTRIBUTING.md): conventions and the definition of done
- [CLAUDE.md](CLAUDE.md): rules for working in this repository (humans and coding agents)
- [docs/architecture.md](docs/architecture.md), [docs/FEATURES.md](docs/FEATURES.md)

## Licence

This project is licensed under the ISC License. See [LICENSE](LICENSE).
