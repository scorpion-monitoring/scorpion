## What and why

<!-- Milestone (M0–M18), what changes, and why. New runtime dependency? Say why it is needed. -->

## Definition of done

Checklist from [docs/implementation.md](../docs/implementation.md) §1. Tick what applies and
write "n/a" next to the rest.

- [ ] Branch follows the policy: `feature/<topic>` into `dev` (see CONTRIBUTING.md, "Branches")
- [ ] Lint, type check and tests pass (`pnpm check`, `pnpm test`, E2E for affected journeys)
- [ ] Every new route declares a `permission` and has a test for a denied request
- [ ] Every multi-row write runs in one transaction and has a rollback test
- [ ] Every input is validated by Zod; invalid input returns 422 and never 500
- [ ] New tables are prefixed with the module name and live in the module's schema and migrations
- [ ] Touched FEATURES.md §5 defects have a `defect-NN.*.test.ts` regression test
- [ ] No breaking change in the public OpenAPI diff (or the API version is bumped, with an ADR)
- [ ] Module `README.md` updated: permissions, settings keys, events, registries, jobs
- [ ] Security-scoped path changed (see CLAUDE.md, "Security assurance")? Updated the matching `docs/security/asvs/` chapter, or label `asvs-no-impact` and a line `ASVS impact: none because …` below. Otherwise n/a
- [ ] Changeset added (`pnpm changeset`, or `--empty`); not needed for docs-only pull requests
