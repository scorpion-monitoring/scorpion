---
'scorpion': minor
---

`bibliometrics` now fetches citation counts and keeps their history. Every Monday at 04:00 UTC the job `bibliometrics.citations.refresh` asks OpenAlex for the number of citations of every DOI the instance lists. Each DOI is asked once, however many services list it. The job also looks up the titles again where the lookup at doi.org had failed. A member of a service's provider or Admin can ask for one service at once ("check now", `POST /api/internal/bibliometrics/services/{serviceId}/citations/refresh`). It is queued for the worker and refused for ten minutes after the last time. The list of publications now gives each publication's `citedByCount` and `citationsAsOf`, and the service's total with how many publications it covers ("312 citations, 4 of 5 found"). The new `GET …/publications/{publicationId}/history` gives a publication's counts over time. The web app does not show any of this yet, and public API v1 is unchanged.

**"Not found" is not zero.** `citedByCount` is `null` in any of these cases:

- OpenAlex does not know a DOI;
- the request for its batch failed;
- lookups are turned off.

A total counts only the known values. OpenAlex knows most journal articles, and Zenodo software and datasets too: the refresh asks OpenAlex's full corpus.

Operators:

- **Outbound requests.** The worker now makes weekly HTTPS requests to `api.openalex.org`: one request per 100 DOIs, so a few requests a week for most instances. It sends no mail address and no other data than the DOIs. Turning the setting `enabled` of `bibliometrics` off stops them, as it stops the lookups at doi.org.
- **The OpenAlex key is optional.** Without a key the instance shares OpenAlex's small free daily budget with everything else on its IP address (about 1,000 requests a day). A free key from openalex.org raises it tenfold. Store it with `pnpm scorpion set-secret bibliometrics.openalex-api-key`. It is sent only in the `Authorization` header and never logged. A key that OpenAlex refuses makes the run record `key-refused` instead of counts.
- **The setting `openalex.mailto` is removed.** It was added in the previous change and was never used; OpenAlex no longer asks for an address.
- **Database and demo data.** The migration adds the tables `biblio_citation_run` and `biblio_citation_snapshot`. `pnpm scorpion seed --demo` adds two fictional citation counts to each demo publication.
