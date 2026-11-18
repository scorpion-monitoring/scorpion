---
'scorpion': minor
---

Operators can now migrate the KPIs, measurements and people of the legacy application: `pnpm migrate-legacy run` also creates the indicators and KPI sets (from the legacy categories, with their necessity), each service's KPIs, the measurements (one value per service, KPI and month, in batches of at most 120 months; the latest point of a month wins; the months the legacy API leaves out as zeros are written as 0), the users with their LS Login identity and the role admin or user, and their provider memberships. `pnpm migrate-legacy users` lists the migrated users and addresses for the announcement mail. A file of subject and username pairs (`--subjects`) tells the tool who is who; a KPI with no thematic category in the mapping stops a run that writes. The account `legacy-migration` is deactivated when a run ends (`--keep-account` keeps it). Nothing changes for running instances.
