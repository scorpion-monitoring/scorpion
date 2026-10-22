---
'scorpion': minor
---

Dashboard: an **Export** menu on the Trends and KPI cards widgets saves the numbers of a service as CSV or XLSX (`GET /kpi/analytics/export`, new permission `kpi.analytics.export` for the role `user`). One row per KPI and one column per month, empty where a KPI has no value; names that look like a formula are neutralised; the CSV is UTF-8 with a byte order mark. A module can add a format through the registry `analytics.exporter`. The dev-only dependency `launch-editor` is pinned to 2.14.2 or later, which closes three Dependabot alerts.
