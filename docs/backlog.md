# Backlog

## Kernel follow-ups

- Outbox retention: a job that deletes events whose deliveries are all `delivered` (and events
  with no subscribers) after a configurable time. Requeue a `dead` delivery from the admin UI (M5).
- Job-run retention: delete old `kernel_job_run` rows.
- `scorpion worker` listens on no port, so it has no liveness or metrics endpoint. Add a small
  internal listener if operators need one (job durations are observed in the worker process, so
  its `/metrics` would be the only place to scrape them when `WORKER_MODE=separate`).
- Start-up preflight for cron expressions: today an invalid `schedule` is reported when the workers
  start, not before migrations.
- Make the image build's lockfile step reproducible: it reuses every locked version, but it does
  rewrite `pnpm-lock.yaml` inside the build stage for non-`full` profiles.

## Later

- Move to TypeScript 7 once typescript-eslint and svelte-check support it.
