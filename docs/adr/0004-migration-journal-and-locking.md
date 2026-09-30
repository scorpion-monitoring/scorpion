# ADR-0004: Migration journal, locking and the table-prefix rule

- Status: Accepted
- Date: 2026-09-30

## Context

Every module owns its tables and its migration folder (ADR-0001, architecture "Data
architecture"). At startup the kernel has to apply them in dependency order, safely when two
processes start at once (a web process and a worker, or two replicas), and it has to enforce that
a module only creates tables of its own.

## Decision

- **One journal table per module**, named `kernel_migrations_<module id>` with dots and dashes
  as underscores (`kernel_migrations_kpi_ingestion`). It has the columns of Drizzle's own journal
  (`id`, `hash`, `created_at` = the migration's `when`), so the folder format stays exactly what
  `drizzle-kit generate` writes. The kernel's own tables use the pseudo-module `kernel`.
  A single `kernel_migration` table keyed by module was the alternative; it gains nothing (each
  module is migrated on its own) and loses the direct fit with Drizzle's format.
- **The runner applies migrations itself** with `readMigrationFiles()` from
  `drizzle-orm/migrator` instead of calling Drizzle's `migrate()`. That lets it run a module's
  pending migrations, the journal writes and the prefix check in **one transaction**. Drizzle's
  `migrate()` commits before we could check anything.
- **The journal tables are created by the runner** (`create table if not exists`), not by a
  migration file: something has to exist before the first migration can be recorded. The other
  kernel tables (outbox, deliveries, job runs) are ordinary migrations in
  `packages/kernel/migrations`, prefix `kernel_`.
- **One advisory lock for the whole run.** The runner takes the session-level lock
  `pg_advisory_lock(0x53434f52, 1)` on a dedicated connection before it creates or reads any
  journal, runs every module in dependency order on that connection, and unlocks in `finally`
  (a connection that failed is destroyed, which frees the lock). A second process blocks on the
  lock and then finds everything applied, so nothing runs twice and nothing fails.
- **The table-prefix rule is checked twice.** Before the database is touched, the tables in a
  module's Drizzle `schema` must carry its prefix. In the migration transaction, the tables that
  the module's migrations created (`information_schema` before and after) must carry it too;
  otherwise the transaction rolls back and startup fails naming the table. Nothing of the module
  is left behind.
- **What "its prefix" means.** A module's table prefix is its id with dots and dashes as
  underscores plus `_` (`kpi.ingestion` → `kpi_ingestion_`), unless the manifest sets
  `tablePrefix`. Prefixes must not overlap (no prefix may start with another module's prefix), so
  every table has exactly one owner, and `kernel_` is reserved.
- `/readyz` uses the same journals: the database is ready when no module has a migration newer
  than the last one recorded.

## Consequences

- Startup takes the lock even when nothing is pending; that costs one round trip.
- A slow migration in one process delays the start of the others. This is accepted: they could
  not run before the schema is complete anyway.
- Migrations cannot be rolled back through the kernel. Forward-only, as with Drizzle.
- **Conflict in the source documents, decided here.** CLAUDE.md gives `kpi_measurement` as an
  example, and implementation.md lists tables such as `identity_user` (module `core.identity`)
  and `ingestion_run` (module `kpi.ingestion`), while architecture.md shows `kpi_ingestion_*`
  for `kpi.ingestion`. These cannot all be the module's id-derived prefix. The kernel follows the
  architecture's `kpi_ingestion_*` by default and lets a module choose another prefix with
  `tablePrefix`, provided no other module's prefix overlaps it. `core.identity` can therefore
  declare `tablePrefix: 'identity_'`; the two `kpi.*` modules cannot both use `kpi_`. The owner of
  the documents should settle the names before M2.
