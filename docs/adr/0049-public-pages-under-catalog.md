# ADR-0049: The public pages and records live under `/catalog`

- Status: Accepted
- Date: 2026-11-06

## Context

The anonymous pages and records of ADR-0036 part 2 were at `/public/services/...`, `/public/organisations/...` and (ADR-0040) `/public/kpi/rimo.*`. The
signed-in service page already owns `/services/:slug`, so the public page needed a prefix, but `/public` named an audience, not a thing, and the pages
were never linked for visitors: there was no way to find one without knowing its slug.

## Decision

1. All public pages and records move under `/catalog`: the pages `/catalog/services/:slug` and `/catalog/organisations/:id`, the routes
   `GET /catalog/services/{ref}` and `/schema-org`, `GET /catalog/organisations/{id}` and `/schema-org`, and `GET /catalog/kpi/rimo.ttl` and `.jsonld`
   (all on the internal surface, never v1). There is **no redirect** from `/public/...`: the pages were never shown to people, and a redirect would be a
   second public address to keep in the rules.
2. A new public landing page `/catalog/services` lists the **published** services (search by name, facets `stage` and `consortium`, pages of the server),
   backed by `GET /catalog/services`. It is public with a reason, in the `default` rate-limit group, answers the same 404 as every public address while
   `service.allowPublic` is off, and its rows and facets are a separate response schema with pinned names (`public-records.test.ts`).
3. `/services` stays the signed-in catalogue. An unpublished service is still the one 404 of an unknown service, at the new addresses too.
4. The Schema.org `@id` of a service and of an organisation names the signed-in page (`/services/{id}`, `/organisations/{id}`); it never named `/public/`, so
   it does not change here (backlog: whether the public profile should identify itself by the public page).

## Consequences

- `PUBLIC_PAGES`, the route tables of `docs/security/authorization.md`, the READMEs, the contract and e2e tests follow. The public API v1 is unchanged.
- An external link to a `/public/...` address of an instance breaks. Nothing public linked there before this release.
