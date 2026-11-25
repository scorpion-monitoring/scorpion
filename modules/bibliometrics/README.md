# bibliometrics

The publications of a service, by DOI, and (from sprint 2) their citation counts over time. Decisions:
[ADR-0056](../../docs/adr/0056-bibliometrics-publications-citations-and-the-trusted-kpi-write.md); plan:
[M16](../../docs/m16-sprint-plan.md).

Status: M16 sprint 1. The internal API exists; the service page shows nothing yet (sprint 3). There are no citations,
no job and no event yet (sprint 2).

The manifest (`module.ts`) is the reference for the permissions, the settings and their meaning
(`pnpm scorpion docs:export`). This file says what the manifest cannot.

## Who may change the publications of a service

`bibliometrics.publication.write` is scoped to the service. Admin holds it for every service. The approved members of
the service's provider, managers included, hold it through the module's resource policy, which asks `registry.services` at
every call. A person who only asked to join, left, or belongs to another provider holds nothing. No role holds it, so an
instance cannot grant it through a role.

The add and remove routes name the plain `bibliometrics.publication.read`, which keeps out anyone who is not signed in.
The service then checks the scoped write with the service as the resource (a delegated route, ADR-0034). A signed-in
non-member gets 403, and gets it before learning whether the service exists.

Publications are visible to signed-in people only. They are not on the public catalogue page and not in public API v1
(both in the backlog).

## Routes

All under `/api/internal/bibliometrics/services/{serviceId}/publications`, answered with `Cache-Control: no-store`:

| Route                     | Answers                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| `GET`                     | The list envelope, 0-based pages, 5 per page by default and at most 50; 404 for an unknown service |
| `POST` `{ doi }`          | 201 with the publication; 409 if the service lists the DOI already; 422 naming `doi`               |
| `DELETE /{publicationId}` | 204; 404 for a publication of another service, which is not touched                                |

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

With `enabled` off the instance makes no request to doi.org (and, from sprint 2, none to OpenAlex).

The lookup goes only to `doi.org` and the registration agency it redirects to (`https:` only, at most five redirects, at
most 1 MiB). What a person types cannot choose the host. Crossref and DataCite (Zenodo software DOIs too) answer;
an agency without CSL-JSON support gives `failed`.

## Audit

Adding and removing a publication write `bibliometrics.publication.added` and `bibliometrics.publication.removed` to the
audit trail, with the service id and the DOI, in the same transaction as the change. Without `core.audit` in the profile
nothing is written and the change still happens.

## Demo data

`pnpm scorpion seed --demo` adds three fictional publications under the Crossref test prefix `10.5555/` to the first two
demo services, with their metadata, and makes no network request.
