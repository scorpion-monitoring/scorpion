---
'scorpion': minor
---

The service page has a section **Publications** (profile `full`). Signed-in people see the publications of a service with title,
authors, date, journal or repository, the citation count from OpenAlex with its date (or "not found in OpenAlex"), the total
("312 citations, 4 of 5 publications found") and a small citation history per publication. Administrators and the approved members of
the service's provider can add a publication by DOI, remove one, and check its citations now (once every ten minutes per service).

The weekly citation refresh can now fill a **Bibliographic KPI**. It is off by default. To turn it on, create a numeric indicator in
the thematic category Bibliographic, add it to the KPI sets of the services that should report it, and choose it under Administration →
Settings → Publications and citations → Bibliographic KPI. Every refresh then writes each service's citation total as the value of the
current month (source `bibliometrics`), replacing an earlier value of that month. A service is skipped, and counted in the job's report,
when one of its publications has no count from that refresh or when its KPIs do not include the indicator. A save that names an
indicator that is not numeric or not in Bibliographic is refused with a 422 on `values.kpi.indicatorId`.

The internal list of publications (`GET /api/internal/bibliometrics/services/{serviceId}/publications`) also answers `canEdit` and
`citations.sourceLabel`. Public API v1 is unchanged.
