---
'scorpion': minor
---

New module `bibliometrics` in the `full` profile: the publications of a service, by DOI. A signed-in person can list the publications of any service; Admin and the approved members of the service's provider can add and remove them (the new scoped permission `bibliometrics.publication.write`). Adding a publication looks up its title, authors, date and journal or repository at doi.org (Crossref and DataCite, Zenodo DOIs included); if the lookup fails, the publication is kept and its title shows as not yet known. The internal API is `GET`, `POST /api/internal/bibliometrics/services/{serviceId}/publications` and `DELETE …/publications/{publicationId}`; the web app does not show publications yet, and public API v1 is unchanged.

Operators: the instance now makes outbound HTTPS requests to doi.org and the registration agency it redirects to (api.crossref.org, data.crosscite.org) when a publication is added. Turn the setting `enabled` of `bibliometrics` off at `/admin/settings/bibliometrics` to stop them. The module's migration adds two tables, `biblio_publication` and `biblio_doi_metadata`; `pnpm scorpion seed --demo` adds three fictional publications.
