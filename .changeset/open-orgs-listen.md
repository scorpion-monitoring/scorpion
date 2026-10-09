---
'scorpion': minor
---

New module `registry.organisations` and a new `registry` profile. The module stores organisations (providers, consortia and any type another module adds) with an abbreviation, name, plain-text description, website, `sameAs` links, ROR id and a contact point (an organisation's role address and its type). Organisation types are a registry, so a module can add one (a funder, for example) without a migration; another module can also block the deletion of an organisation, or a change of its type, while it still refers to it.

For operators: the `registry` profile is the seven core modules plus `registry.organisations` (later releases add the services and the public API). CI now builds and publishes its image next to the others: after the merge `ghcr.io/scorpion-monitoring/scorpion:dev-registry` appears (and `<x.y.z>-registry` for a release). The `full` profile gains the module too. The module adds one migration (the table `org_organisation`) and no setting yet; `core.audit` now logs the three organisation events (`registry.organisation.created`, `.updated`, `.deleted`).

For API users: new internal routes `GET /organisations` (search, type filter, pages), `GET /organisations/{id}`, `GET /organisation-types`, and `POST`, `PATCH` and `DELETE` on organisations. Any signed-in person can read; the permission `registry.organisations.organisation.manage` (Admin) is needed to write. The roles User and Reviewer get `registry.organisations.organisation.read`. Deleting an organisation that another module still refers to answers 409 `organisation-in-use`. There is no public API route and no screen yet.
