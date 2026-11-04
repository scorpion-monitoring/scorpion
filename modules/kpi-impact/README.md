# kpi.impact

The impact figures of a consortium for Reviewers and Admin: how many services it has, how many are open source, and how many are in each stage. **Defect 9**
of [FEATURES.md](../../docs/FEATURES.md) §5 is what it must not repeat (a stage that was counted but not in the enum, and stage labels that differed between
screens). The decisions are in [ADR-0048](../../docs/adr/0048-impact-read-model.md), the plan in [m12-sprint-plan.md](../../docs/m12-sprint-plan.md).

Status: **M12 sprint 1** (`0.15.0` when the milestone releases): the module, the tiles and two internal routes. Nothing is on screen yet; the yearly table
(sprints 2 and 3) and the page (sprint 4) follow. The module is in the `full` profile only.

## Manifest

| Part                               | Value                                                                                                                                                                                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id                                 | `kpi.impact` (package `@scorpion/kpi-impact`)                                                                                                                                                                                                                             |
| tables                             | **none** in sprint 1, and so no table prefix; sprint 3 adds `kpi_impact_year` and `kpi_impact_refresh`                                                                                                                                                                    |
| dependencies                       | `core.authz`, `core.settings` (the vocabulary `stage`), `registry.organisations` (the consortia) and `registry.services` (the rows and the licence facts). `kpi.framework`, `kpi.ingestion`, `kpi.analytics` and the optional peer `core.ui-shell` join in sprints 2 to 4 |
| routes                             | internal: `GET /kpi/impact/consortia`, `GET /kpi/impact/summary`; never public v1                                                                                                                                                                                         |
| permissions                        | the plain `kpi.impact.read`, held by the role `reviewer` and by Admin, **not** by `user`                                                                                                                                                                                  |
| events, jobs, settings, registries | none                                                                                                                                                                                                                                                                      |
| demo data                          | none: the module owns no data (its tables of sprint 3 are a derived read model), so there is no `demoSeed` (ADR-0046)                                                                                                                                                     |

## The tiles

`GET /kpi/impact/summary?consortium=<id>[&includeUnpublished=true][&locale=de]` counts **live** on every request (`Cache-Control: no-store`):

| Field                                     | Meaning                                                                                                                                                                    |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `total`                                   | the services counted: the **published** ones of the consortium, or every linked one with `includeUnpublished=true` (decision 16)                                           |
| `openSource`                              | the licence is an **OSI-approved, not deprecated** SPDX id (decision 19)                                                                                                   |
| `licenceDeprecated`                       | a deprecated SPDX id, OSI-approved or not: **not** open source                                                                                                             |
| `licenceUnknown`                          | no licence, or an id the SPDX list does not know: not open source                                                                                                          |
| `otherLicence`                            | a current licence that is not OSI-approved. The four counts add up to `total`                                                                                              |
| `stages: [{ key, label, active, count }]` | **one line per term of the vocabulary `stage`**, active or deactivated, in the vocabulary's order, zero counts too; `label` is the vocabulary's in `locale` (default `en`) |
| `otherStages: [{ key, count }]`           | a stage key services hold and the vocabulary does not list: shown by its key, never dropped                                                                                |

A service is counted **once** in each consortium it is linked to (role `consortium`) and in none when it has no link. A `consortium` that is no id, names no
organisation or names one that is not a consortium is a **422 naming `consortium`**; a consortium of more than 2,000 services is one too, never a silent cut.
`GET /kpi/impact/consortia` lists `{ id, name, abbreviation }` of the organisations of type `consortium` in the list envelope.

The licence verdict comes from the same SPDX adapter (24 h cache, bundled fallback) as the licence field of a service, through `registry.services`'s
`findLicencesAsSystem`; the live fetch is never used in a test.

## Who may read

The plain `kpi.impact.read` on the route and again in the service, **before** the consortium is looked at. 401 anonymous, 403 for `user`, 200 for a Reviewer and
Admin. The answers hold counts, labels and consortium names, no person and no service name. See [docs/security/authorization.md](../../docs/security/authorization.md).

## The reads it uses

`registry.organisations.listConsortiaAsSystem()`, `registry.services.listImpactRowsAsSystem(consortiumId)` and `registry.services.findLicencesAsSystem(ids)`,
and `core.settings`'s `listTerms('stage', { includeInactive: true, locale })`. The module reads no other module's table.

## Tests

`service/tiles.test.ts` (pure, table-driven), `service/impact.test.ts` (real Postgres: denied per caller class, the consortium check, two consortia, the
published switch, the licence verdicts through the stub SPDX), `defect-09.stage-labels.test.ts` (never weaken it), `module.test.ts`, and
`apps/server/src/impact-routes.test.ts` (the routes through the pipeline). The trusted reads are tested in their owning modules.
