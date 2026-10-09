---
'scorpion': minor
---

The profile `kpi-tracker` is now called `core-only` and holds the core modules only (it already did). The profiles `denbi-registry` and `nfdi-onboarding`, which listed no modules, are removed. **Build with `--profile core-only` or `PROFILE=core-only`** where you used `kpi-tracker`; the image is tagged `scorpion:<version>-core-only`. Profiles for the registry and KPIs return with the milestones that need them (ADR-0030).
