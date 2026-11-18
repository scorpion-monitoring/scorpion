---
'scorpion': patch
---

The legacy migration no longer gives every KPI set all KPIs as mandatory: a category's set now holds only the KPIs that the legacy data gives a necessity for that category (the legacy route lists every KPI under every category). `pnpm migrate-legacy run --skip-users` runs only the registry, KPIs and measurements, for an instance without an OIDC provider. A dry run now reports a service's set and extra KPIs as changing when the set or KPI is not created yet, and `plan` suggests dropping the KPI set of the category that holds only consortium workaround services. Nothing changes for running instances.
