---
'scorpion': minor
---

Organisations can be read as Schema.org `Organization` profiles and carry a logo. The role Reviewer now also reads organisations by default.

For API users: new internal route `GET /organisations/{id}/schema-org` answers `application/ld+json` (`@context: https://schema.org`, `Cache-Control: private, no-cache`) for any signed-in person; there is no anonymous access. It maps the abbreviation, name, description, website, `sameAs` links, ROR id, logo and contact point; a property without a value is left out, and the output is escaped so it can be embedded in a page. `PUT /organisations/{id}/logo` (raw image body, as `PUT /account/avatar`) and `DELETE /organisations/{id}/logo` need `registry.organisations.organisation.manage` (Admin). A raster is re-encoded without metadata, an SVG is sanitised, anything else is 422 and a body above the upload ceiling is 413. `GET /organisations/{id}` now shows `logoUrl` (below the base path) when there is a logo. A replaced or removed logo, and the logo of a deleted organisation, is released and removed after the grace period.

For operators: the new setting `organisation.exposeContactPoint` (default on) decides whether every signed-in person sees the contact point of an organisation, in the record and in its profile. Administrators always see it; with the setting off nobody else does. It is the organisation's role address, never a user's, and it is never in a list, an event, the audit trail, a log line or a mail. The new permission `registry.organisations.organisation.read-contact` (scoped to the organisation; Admin holds it) prepares the same right for organisation managers. The role Reviewer gets `registry.organisations.organisation.read` by default. No migration.
