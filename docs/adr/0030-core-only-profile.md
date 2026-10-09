# ADR-0030: `core-only` replaces the empty example profiles

- Status: Accepted
- Date: 2026-10-09

## Context

Gate 1 asks for a `core-only` profile image on staging. The repository had four profiles: `full`, `denbi-registry`, `nfdi-onboarding`
(both with an empty module list) and `kpi-tracker` (the seven core modules, with a comment that it is the target of Gate 3).
`kpi-tracker` already held exactly the core modules, and the two empty profiles built images that contained nothing.

## Decision

1. `kpi-tracker` is renamed `core-only`: the core modules (`core.authz`, `core.settings`, `core.blob`, `core.notifications`,
   `core.identity`, `core.audit`, `core.ui-shell`) and nothing else. It is the Gate 1 staging image.
2. `denbi-registry` and `nfdi-onboarding` are removed. The CI image matrix, `README.md`, `CLAUDE.md` and the profile test list `full` and
   `core-only` only.
3. Profiles for the registry and for KPIs are added by the milestone that first needs them (M6 for a registry profile, M9 for a KPI
   profile), with their own module lists. The columns in `docs/architecture.md` remain the plan for those profiles; Gates 2 and 3 in
   `implementation.md` no longer name a profile.

## Consequences

- The profile name `kpi-tracker` no longer exists. Nothing was deployed under it (no release builds an image yet), so no operator is
  affected.
- Fewer images in CI: two real profiles plus the fixture profile.
