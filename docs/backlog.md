# Backlog

## M1

- Install only the profile's modules in the image build.

## Kernel follow-ups

- Outbox retention: a job that deletes events whose deliveries are all `delivered` (and events
  with no subscribers) after a configurable time. Requeue a `dead` delivery from the admin UI (M5).
- Job-run retention: delete old `kernel_job_run` rows.

## Later

- Move to TypeScript 7 once typescript-eslint and svelte-check support it.
