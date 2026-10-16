---
'scorpion': minor
---

Administrators can now create, change and delete indicators and KPI sets in the browser (Administration, Indicators and KPI sets) and through the internal API (`/kpi/indicators`, `/kpi/sets`, `/kpi/value-types`). An indicator has a name, description, example, value type, unit, optional bounds, thematic category, means of measurement and tools; a KPI set has the indicators with a necessity each and a headline evaluation. Names with spaces or percent signs work, an indicator that a set still uses cannot be deleted (409 names the count), and a set is written in one piece. New permissions: `kpi.framework.indicator.read` and `.manage`, `kpi.framework.set.read` and `.manage`; signed-in users may read, administrators manage.
