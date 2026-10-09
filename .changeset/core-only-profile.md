---
'scorpion': minor
---

The profile `kpi-tracker` is now called `core-only` and holds the core modules only (it already did). The profiles `denbi-registry` and `nfdi-onboarding`, which listed no modules, are removed. **Build with `--profile core-only` or `PROFILE=core-only`** where you used `kpi-tracker`; the image is tagged `scorpion:<version>-core-only`. CI now publishes the images of `full` and `core-only` to `ghcr.io/scorpion-monitoring/scorpion`: `dev-<profile>` for every push to `dev`, `<x.y.z>-<profile>` for every release tag (CONTRIBUTING.md, "Images in the registry"). Profiles for the registry and KPIs return with the milestones that need them (ADR-0030).
