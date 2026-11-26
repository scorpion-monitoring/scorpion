---
'scorpion': minor
---

The service page has a section **Publications** (profile `full`). Signed-in people see the publications of a service with title,
authors, date, journal or repository, the citation count from OpenAlex with its date (or "not found in OpenAlex"), the total
("312 citations, 4 of 5 publications found") and a small citation history per publication. Administrators and the approved members of
the service's provider can add a publication by DOI, remove one, and check its citations now (once every ten minutes per service).

The weekly citation refresh can now fill two **Bibliographic KPIs**, both off by default and written so that the Trend widget, which adds
the months up, shows totals: **new citations per month** (the service's citation total minus what earlier months hold; the whole total
the first time; negative when the total fell) and **publications per month** (how many were issued in each month, from the first
publication to now). To turn them on, create numeric indicators in the thematic category Bibliographic (the citations one without a
minimum of 0), add them to the KPI sets of the services that should report them, and choose them under Administration → Settings →
Publications and citations → Citations KPI and Publications KPI. A service is skipped, and counted in the job's report, when one of its
publications has no count from that refresh (citations), when one has no known month of publication (publications), or when its KPIs do
not include the indicator. Members of the provider give a missing month with "Set the month" on the service page, and may correct any
date there. A save that names an indicator that is not numeric or not in Bibliographic, or the same indicator for both, is refused with
a 422.

The internal list of publications (`GET /api/internal/bibliometrics/services/{serviceId}/publications`) also answers `canEdit`, `undated`,
`citations.sourceLabel` and per row `issued` and `monthKnown`; `PATCH .../publications/{publicationId}` gives the date of a publication. Public API v1 is unchanged.
