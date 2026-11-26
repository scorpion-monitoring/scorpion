# bibliometrics

The publications of a service, by DOI, and their citation counts over time. Decisions:
[ADR-0056](../../docs/adr/0056-bibliometrics-publications-citations-and-the-trusted-kpi-write.md); plan:
[M16](../../docs/m16-sprint-plan.md).

Status: M16 done (sprint 3). The service page has a section "Publications"; the weekly citation refresh can fill a
Bibliographic KPI ([below](#the-bibliographic-kpi)).

Dependencies: `core.authz`, `core.settings`, `registry.services`, `kpi.framework` (the indicator of the KPI) and
`kpi.ingestion` (its trusted write); `core.ui-shell` is an optional peer (the `ui` entry runs in its web app). Nothing
depends on `bibliometrics`.

The manifest (`module.ts`) is the reference for the permissions, the settings and their meaning
(`pnpm scorpion docs:export`). This file says what the manifest cannot.

## Who may change the publications of a service

`bibliometrics.publication.write` is scoped to the service. Admin holds it for every service. The approved members of
the service's provider, managers included, hold it through the module's resource policy, which asks `registry.services` at
every call. A person who only asked to join, left, or belongs to another provider holds nothing. No role holds it, so an
instance cannot grant it through a role.

The add, remove and "check now" routes name the plain `bibliometrics.publication.read`, which keeps out anyone who is not signed in.
The service then checks the scoped write with the service as the resource (a delegated route, ADR-0034). A signed-in
non-member gets 403, and gets it before learning whether the service exists.

Publications are visible to signed-in people only. They are not on the public catalogue page and not in public API v1
(both in the backlog).

## Routes

All under `/api/internal/bibliometrics/services/{serviceId}`, answered with `Cache-Control: no-store`:

| Route                                       | Answers                                                                                                                                            |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /publications`                         | The list envelope, 0-based pages, 5 per page by default and at most 50, plus `citations` (the service total); 404 for an unknown service           |
| `POST /publications` `{ doi }`              | 201 with the publication; 409 if the service lists the DOI already; 422 naming `doi`                                                               |
| `DELETE /publications/{publicationId}`      | 204; 404 for a publication of another service, which is not touched                                                                                |
| `GET /publications/{publicationId}/history` | The citation counts over time: one point per source and day (the latest of the day), the last 520, oldest first; 404 for another service's         |
| `POST /citations/refresh` ("check now")     | 202 with `runIds` (one per citation source that is on); 409 while lookups are off; 429 with `Retry-After` within ten minutes (rate limit `strict`) |

The list is ordered by the date the work was issued, newest first, with unknown dates last, then by id. Dates are as
precise as the registration agency knows them: `2020`, `2020-09` or `2020-09-16`.

## The DOI and its metadata

A DOI may be given as `10.1234/abc`, `doi:10.1234/abc` or `https://doi.org/10.1234/abc` (any case). It is stored lower
case without the prefix, so two spellings of one DOI are a duplicate.

Adding a publication looks the DOI up at `doi.org` (CSL-JSON, adapter `doi` of `packages/integrations`) before it
answers, within 5 seconds. The answer is kept per DOI in `biblio_doi_metadata` and shared by every service that lists the
DOI. It outlives the publications. Its `status` means:

| `status`    | Meaning                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------- |
| `ok`        | Title, authors (at most 100), date, journal or repository, type. Reused by every later add of the DOI               |
| `not-found` | doi.org does not know the DOI. Asked again when the DOI is added anew, for example once it has been registered      |
| `failed`    | The lookup did not work (timeout, the agency answered no CSL-JSON, ...). The publication is kept; asked again later |
| none        | The setting `enabled` was off when it was added, so nothing was asked                                               |

With `enabled` off the instance makes no request to doi.org and none to OpenAlex.

The lookup goes only to `doi.org` and the registration agency it redirects to (`https:` only, at most five redirects, at
most 1 MiB). What a person types cannot choose the host. Crossref and DataCite (Zenodo software DOIs too) answer;
an agency without CSL-JSON support gives `failed`.

## Citations

Every Monday at 04:00 UTC the job `bibliometrics.citations.refresh` asks every citation source that is on for the
citation counts of all DOIs the instance lists. Each DOI is asked once, however many services list it. The only built-in
source is OpenAlex (`https://api.openalex.org/works`, 100 DOIs per request, at most three attempts, 5 seconds each).
One run of the job handles at most 2,000 DOIs and queues the next part. It also looks up again the title of every DOI
whose lookup failed, or that was added while lookups were off. A DOI that doi.org did not know (`not-found`) is not
asked again; adding it anew asks again. The admin job page (`/admin/system`) lists the runs with their counts; it has no
"run now" (a platform trigger is in the backlog), so between two Mondays only "check now" of one service starts a refresh.

What a run stored is kept as history: one snapshot per DOI and source, with its date. Running twice on one day is harmless:
the history keeps the latest count of each day.

**Unknown is not zero.** A publication has `citedByCount: null` until a source has given a count. That happens when:

- it has not been asked yet;
- OpenAlex does not know the DOI (it indexes most journal articles, and Zenodo software and datasets in its "expansion"
  corpus, which the refresh includes);
- the request for its batch failed (the run records `failed` and why);
- lookups are off.

A count of 0 that OpenAlex gave is shown as 0. The service total (`citations` in the list) adds up the known counts and
says over how many publications it is taken: `{ total: 312, found: 4, of: 5 }`. With no known count, `total` is `null`.

**Check now** (`POST .../citations/refresh`) queues the refresh of one service for the job and answers 202 at once; the
counts appear when the worker has run it. It needs the same scoped write as adding a publication, and it is refused for
ten minutes after the last "check now" of that service. This keeps a person from spending the instance's daily OpenAlex
budget. The weekly run does not count toward the ten minutes.

**Runs** are rows of `biblio_citation_run`: per source and part, `asked`, `found`, `failed`, and a fixed `error` text
such as `rate-limited: 100 DOIs`. It never holds a URL or a key.

### The OpenAlex key

OpenAlex needs no account. Without a key, an instance shares a small daily budget with everything else on its IP address
(about 1,000 requests of 100 DOIs, more than enough for the weekly run). A free key raises it tenfold. To use one, get it at
`openalex.org` (a verified mail address) and store it:

```bash
pnpm scorpion set-secret bibliometrics.openalex-api-key
```

It is read at every batch, sent only in the `Authorization` header, and never logged. A key that OpenAlex refuses makes
the batch fail with `key-refused`; nothing falls back to keyless. The instance sends no mail address to OpenAlex (the old
`mailto` parameter is no longer documented).

### Adding a citation source

Another module contributes an entry to the registry `biblio.citationSource`:
`{ id, label, enabled(settings), fetchCounts(dois, { signal }) }`. `fetchCounts` gets at most 100 normalised DOIs and
answers `{ counts, notFound, failed: [{ dois, reason }] }`; it never writes. Every entry that is on is asked, and its
snapshots are stored under its `id`. The list and the total show the first entry of the registry that is on (OpenAlex).

### The event

`bibliometrics.citations.updated@1` is emitted when a run of a source finishes: `runId`, `serviceIds` (at most 2,000),
`found`, `failed`. Ids and counts only, never a DOI, a title or a URL. Nothing listens yet.

## The Bibliographic KPI

Off by default. To turn it on:

1. Create (or choose) an indicator in **Administration → Indicators** with a **numeric** value type (a whole number fits
   a citation count) and the thematic category **Bibliographic**.
2. Add it to the KPI sets of the services that should report it (or as an extra of a service).
3. Choose it in **Administration → Settings → Publications and citations → Bibliographic KPI**. The picker offers only
   numeric indicators in `Bibliographic`, and the server refuses any other with a 422 on `kpi.indicatorId`, whatever
   sends it (a contribution to `core.settings`' registry `settings.check`, ADR-0057).

From then on every refresh (the Monday run and "check now") writes, for each service it covers, the citation total as
the value of the **current month**, with source `bibliometrics`, through `kpi.ingestion`'s trusted
`upsertBatchAsSystem` (ADR-0056 decision 7). A second run in the month replaces the value; earlier months are never
written. A service is **skipped**, and counted in the job's report, when:

| Report count           | Why                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `kpiSkippedNotInSet`   | its effective KPI set does not hold the indicator (never an error)                                                                   |
| `kpiSkippedIncomplete` | one of its publications has no count from this refresh (not found, failed, or asked by an earlier run): a partial total is not a drop |
| `kpiFailed`            | `kpi.ingestion` refused the value (a bound of the indicator, a set changed meanwhile); logged with the service id                    |

`kpiWritten` counts the values written; `kpi` is `off` with the setting empty and `unusable` when the chosen indicator was
deleted or is no longer numeric and Bibliographic (nothing is written; the log says so). An indicator that changed
category later does not stop an administrator from saving the other settings: only a changed `kpi.indicatorId` is
checked. The total is that of the source the list shows (OpenAlex), and a service whose DOIs cross two slices of the
weekly run is decided by the slice that holds its last DOI.

## Audit

Adding and removing a publication write `bibliometrics.publication.added` and `bibliometrics.publication.removed` to the
audit trail, with the service id and the DOI, in the same transaction as the change. Without `core.audit` in the profile
nothing is written and the change still happens.

## Demo data

`pnpm scorpion seed --demo` adds three fictional publications under the Crossref test prefix `10.5555/` to the first two
demo services, with their metadata and two fictional citation counts a week apart, and makes no network request.
