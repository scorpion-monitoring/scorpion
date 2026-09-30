# Scorpion

Scorpion is a service registry and KPI tracker for research infrastructures (de.NBI, NFDI).
This repository is the rebuild as a **modular monolith**: one server, one PostgreSQL database,
many modules. A deployment **profile** selects the modules at build time.

Status: milestone **M0** (repository and toolchain bootstrap). The server answers only
`GET /healthz`, and the web app shows a placeholder page. See
[docs/implementation.md](docs/implementation.md) for the milestone plan.

## Prerequisites

- Node.js 24 LTS (`.nvmrc`)
- pnpm 10 through Corepack: `corepack enable`
- Docker Engine with the Compose plugin (dev services, Testcontainers, image builds)

## Quick start

```bash
pnpm i
pnpm dev          # Postgres + Mailpit (Docker), server on :3000, web on :5173
curl localhost:3000/healthz
```

Mailpit's web UI runs on <http://localhost:8025> (SMTP on port 1025).

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
matrix is in [docs/architecture.md](docs/architecture.md). In M0 every profile's module list is
still empty.

```bash
PROFILE=kpi-tracker pnpm dev
docker build -f docker/Dockerfile --build-arg PROFILE=kpi-tracker -t scorpion:dev-kpi-tracker .
```

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
adds one with `pnpm changeset`; see [CONTRIBUTING.md](CONTRIBUTING.md).

## Further reading

- [CONTRIBUTING.md](CONTRIBUTING.md): conventions and the definition of done
- [CLAUDE.md](CLAUDE.md): rules for working in this repository (humans and coding agents)
- [docs/architecture.md](docs/architecture.md), [docs/FEATURES.md](docs/FEATURES.md)

## Licence

Not chosen yet; see [LICENSE](LICENSE).
