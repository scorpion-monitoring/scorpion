---
'scorpion': minor
---

`kpi.impact` adds `GET /kpi/impact/table?consortium=&year=`, the yearly table of one consortium for Reviewers and Admin (`kpi.impact.read`): one row per service with the twelve months of its headline KPI, the yearly aggregate over the months that have a value ("n of 12") and a state that says what to do (`ok`, `no-data`, `no-evaluation`, `error`). The current evaluation applies to every year; the years offered are the current one and the nine before. Only published services are listed unless `includeUnpublished=true`; a page is 50 services, at most 200. The figures are computed live. Nothing is on screen yet, and the public API is unchanged.
