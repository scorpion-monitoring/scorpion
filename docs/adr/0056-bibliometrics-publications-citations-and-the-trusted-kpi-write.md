# ADR-0056: Bibliometrics: publications, citation snapshots and the trusted KPI write

- Status: Accepted (M16)
- Date: 2026-11-25
- Plan: [M16 sprint plan](../m16-sprint-plan.md)
- Relates to: [ADR-0004](0004-migration-journal-and-locking.md), [ADR-0034](0034-scoped-permissions-at-the-route-and-delegation.md), [ADR-0041](0041-measurement-model.md)

## Context

Services cite publications: the paper that describes a tool, the Zenodo record of a release. FEATURES §3.12 asks for a list
of publications per service, added by DOI with duplicate detection and removable, and for their citation counts over time;
the architecture names the module `bibliometrics` with the tables `publication` and `citation_snapshot`, a weekly refresh, the
registry `biblio.citationSource` with OpenAlex first, and an optional Bibliographic KPI written through the ingestion API.
The legacy application stores no publications, so the module starts empty.

Three things need deciding before the code: how the data is shaped so that a DOI that two services list is looked up once,
who may change a service's publications, and how a weekly job with no person behind it can write a KPI value when the only
write path of measurements, `upsertBatch()`, checks the caller's scoped permission.

## Decision

1. **Tables and prefix.** The manifest sets `tablePrefix: 'biblio_'` (ADR-0004, as `svc_` and `kpii_` do), matching the
   registry name `biblio.citationSource`. `biblio_publication` holds one row per (service, DOI) with a **unique
   `(service_id, doi)`**; the DOI is stored normalised (lower case, no `https://doi.org/`, `doi.org/` or `doi:` prefix).
   `service_id` is a plain `uuid`, checked by asking `registry.services`, never a foreign key into its tables. Removal is by
   id, scoped to the service (defect 7's lesson). `biblio_citation_run` and `biblio_citation_snapshot` follow in sprint 2.
2. **The metadata is a cache of the DOI, shared across services.** `biblio_doi_metadata` has the DOI as its key: title,
   authors (at most 100), the issued date with its precision, the container, the CSL type, and a status `ok`, `not-found`
   or `failed`. It is kept permanently (the architecture's "permanent per DOI"); a `failed` row is retried by the weekly job,
   a `not-found` row is not. Citation snapshots belong to the DOI too, so a DOI that two services list is fetched once. The
   metadata row is written **outside** the transaction of the publication: it is a cache, not domain data, and a slow or
   failing resolver must not undo the add.
3. **The metadata is resolved in the request** that adds the publication (decision 6 of the plan), with the resolver's
   5 second deadline. If it fails, the publication is kept and its metadata is `failed` ("title not yet known").
4. **Permissions.** `bibliometrics.publication.read` is plain and held by the role `user` (services are readable by every
   signed-in person; publications are not public, decision 3). `bibliometrics.publication.write` is **scoped to `service`**:
   Admin holds it everywhere, and the approved members and managers of the service's provider hold it through an
   `authz.resourcePolicy` that asks `registry.services.isProviderMemberAsSystem` at every call, as `kpi.ingestion`'s `submit`
   does. It is not `registry.services.service.edit`, so an instance can give publication upkeep to a role without full service
   editing, and the modules stay independent. Because the pipeline checks a route's permission without a resource, the write
   routes carry the plain read and are **delegated** (ADR-0034): the service checks the scoped write with the service as the
   resource, so a signed-in non-member is 403 and an anonymous caller 401.
5. **Unknown is not zero.** A DOI that a citation source does not know, a failed batch and a source that is turned off are
   `null` (unknown), never `0`. A service's total says over how many publications it is taken. The KPI write (sprint 3) takes
   the total only when every publication of the service was found in the run, so a monthly value never drops because a
   source failed.
6. **Outbound requests are bounded.** Every adapter in `packages/integrations` has a timeout (5 s), a capped retry with
   backoff on 429 and 5xx honouring `Retry-After`, a maximum body size, and a shape check (an HTML page is a failure, not
   data). The DOI adapter validates the DOI (`10.<registrant>/<suffix>`, at most 256 characters, no whitespace) before any
   request, encodes it segment by segment into the path of `https://doi.org/`, and follows at most five redirects, to
   `https:` addresses only. No adapter logs a URL with a query string or a key; a failure is a fixed reason code.
7. **The trusted KPI write** (decided now, built in sprint 3). `kpi.ingestion` gains `upsertBatchAsSystem(serviceId, rows,
{ source })`, the sibling of `upsertBatch()`: the same validation against the service's effective KPI set, the same
   `ON CONFLICT (service, indicator, period)` upsert (defect 6) and the same `measurement.recorded@1` event with
   `actorId: null`. It skips only the scoped permission check. It is exported through `public.ts` with a comment that it is
   for trusted module code only (like `SettingsService.getSecret`), it has no route, and `bibliometrics` writes with source
   `bibliometrics`. The indicator is chosen by id in a setting (empty by default, so off), never by name.

   A trusted write is preferred to a service account, as the migration tool uses one (ADR-0052): the account model of the
   push-agent brainstorm in the backlog is not built yet, a service account would need provider membership of every service
   or a grant of Admin, and this write never leaves the server process.

8. **No listener of `service.updated`.** The architecture's table says the module listens to `service.updated`. Nothing in
   the module depends on a service's fields (it stores the id only), and a service is never deleted, so there is nothing to
   clean up. The module listens to no event; if services become deletable, a listener that removes the publications of a
   deleted service is added then.

## Consequences

- A DOI resolved once serves every service that lists it, and its metadata outlives the publication rows. Adding a
  publication reuses only an `ok` row; a `not-found` or `failed` row is asked again, so adding the DOI anew is how a
  person gets a DOI registered since its last lookup. The weekly job retries only `failed`.
- An instance that turns the module's `enabled` setting off makes no outbound request; publications added meanwhile have no
  metadata until the weekly job of sprint 2 resolves them.
- The trusted write is a second way into `kpii_measurement` without a permission check. It is not routed, it is documented
  as trusted, and a test in `bibliometrics` checks that only the refresh calls it; `measurement.source` tells its values
  from form and file submissions.
- `bibliometrics` is the first module to write `ctx.audit` entries from its service inside the domain transaction. It needs
  no dependency on `core.audit`: the entry goes through the kernel's audit sink, which is a no-op in a profile without it.
