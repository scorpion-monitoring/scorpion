---
'scorpion': minor
---

A new module, `kpi.impact` (full profile only), adds the permission `kpi.impact.read`, held by the role `reviewer` and by Admin, and two internal routes: `GET /kpi/impact/consortia` lists the consortia, and `GET /kpi/impact/summary?consortium=` counts the services of one consortium (open source by the SPDX list, a deprecated licence on its own line, and one line per term of the vocabulary `stage`, deactivated terms and unlisted keys included). Only published services are counted unless `includeUnpublished=true`. Nothing is on screen yet, and the public API is unchanged.
