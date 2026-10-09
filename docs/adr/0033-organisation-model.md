# ADR-0033: the organisation model

- Status: Accepted (the sections marked *to be finished* are decided here and completed in the sprint named)
- Date: 2026-10-09

## Context

FEATURES §3.4 describes two tables (providers and consortia). The architecture asks for one `organisation` table typed by a registry
entry. M6 builds it ([m6-sprint-plan.md](../m6-sprint-plan.md)); M7 (services) and M8 (public API) read it; M13 imports into it.

## Decisions

### Table prefix and ownership

The module `registry.organisations` sets `tablePrefix: 'org_'` (ADR-0004), as `core.audit` does with `audit_`. Tables are
`org_organisation` and, from sprint 3, `org_membership`. User ids and the logo's blob id are plain columns without a foreign key,
so a purge or the blob cleanup cannot be blocked. No pg enum: the check constraints and the registry carry the closed sets.

### One table, typed by a code registry

`org_organisation.type` is plain text, checked against the registry `org.type` in the service. An entry is
`{ id, labels: { en, de? }, membership, schemaType?, order }`. It is a **code registry, not a vocabulary**: a type carries behaviour
(`membership`, `schemaType`) and M7 depends on it. The module contributes `provider` and `consortium` (both `membership: true`);
another module may contribute `funder` without editing this one. A stored organisation whose type is no longer registered is still
listed and readable with `typeKnown: false` and cannot be written to until the type is back.

### `org.usage`

A second registry, `{ id, count(tx, organisationId) }`, with the contributing module's id as `id`. Deleting an organisation and
changing its type ask every entry; a count above zero is `409 organisation-in-use` naming the module ids, never the rows. M7
contributes the entry for `service_organisation`. Without a contributor nothing blocks.

### Fields, uniqueness and the lookup key

Fields: type, abbreviation, name, plain-text description, website, `sameAs` (list of `http(s)` URLs, at most 20), ROR id (stored as
the bare id), contact point (`contact_email` and `contact_type`, set together), logo. Name and abbreviation are unique per type,
case-insensitively; a ROR id names one organisation. **The abbreviation, not the name, is the lookup key** for M7 and M8
(`findByAbbreviation(type, abbreviation)`): it has a fixed format (no whitespace or `/`), is short, is stable in URLs and in legacy
data, whereas the name is free text that organisations reword. Hierarchy (`parentOrganization`) is not modelled.

### Schema.org profile

One pure function maps the record to a schema.org `Organization` (mapping table in the sprint plan, §3); the API route, the detail
page and later the public API use only that function. Properties without a value are omitted. *To be finished in sprint 2 (builder,
route and the escaping function `serializeJsonLd`) and sprint 4 (the one audited `{@html}` component for the JSON-LD block).*

### Logo

A module stores an image through its own route, its own permission and the blob service of `core.blob`; `POST /files` and
`core.blob.manage` stay for the branding logos. The columns `logo_blob_id` and `logo_hash` exist from sprint 1 and stay unused until
sprint 2, which adds `PUT` and `DELETE /organisations/{id}/logo` with `setReference` on replace and delete. *To be finished in sprint 2.*

### Contact point

The contact address is the organisation's role address, not a user's address; it belongs to no account and is never a mail recipient.
It is read by administrators and the organisation's managers always, and by other signed-in persons when the setting
`organisation.exposeContactPoint` is on (default on). It is never in a list row, an event, an audit entry, a log line or a mail.
*To be finished in sprint 2 (the visibility check) and sprint 4 (the field table in `authorization.md`).*

### Two editor groups and the field rules per role

The record has two editor groups. An Admin edits every field and alone creates and deletes organisations. The managers of an
organisation (sprint 3) edit `description`, `website`, `sameAs`, `rorId`, `logo` and the contact point of their own organisation, never
`type`, `abbreviation` or `name`: those identify the record (membership, `org.usage`, `@type`, the lookup key, the name shown by
services). There is one `update` method and one logo path; a pure field-rules table (`service/field-rules.ts`) maps a set of fields to
the access it needs (`admin` or `edit`), so the second group adds a policy answer, never a second code path. A request that touches a
field its caller may not write is refused whole (403). In sprints 1 to 3 Admin is the only group. No review step for manager edits in
M6. *To be finished in sprint 4.*

### Membership

One row per person and organisation with a state (`requested`, `approved`, `rejected`, `left`) and a role (`member`, `manager`);
a later request reopens the row; the history is the audit trail. Decisions by administrators and by managers of that organisation;
nobody decides on their own request or changes their own role. *To be finished in sprint 3 with ADR-0034.*

## Consequences

- A new organisation type needs no migration.
- M7 and M8 depend on `public.ts` only, with trusted reads that check no permission.
- Sections marked "to be finished" are updated by the sprint that builds them; a decision that changes is a new ADR.
