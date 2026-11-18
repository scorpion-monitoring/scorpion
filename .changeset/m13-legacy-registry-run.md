---
'scorpion': minor
---

Operators can migrate the registry of the legacy application: `pnpm migrate-legacy plan` writes a mapping file with every gap marked, and `pnpm migrate-legacy run` creates or updates providers, consortia and services through the services as the account `legacy-migration`, with a dry run (`--dry-run`, nothing is written), `--yes` before any write, and a report of every record dropped or changed with the rule that decided it. Repeating a run is safe. Migrated services stay private. Nothing changes for running instances.
