---
'scorpion': patch
---

Adds the module `kpi.ingestion` to the `full` profile (the measurement tables and the service that records them; there is no route or page yet) and records the history of each service's KPIs in `kpi.framework`. A migration runs at the next start: it creates `kpii_measurement` and `kpii_ingestion_run`, and creates `kpif_service_kpi_history`, filled from the KPI sets the services have today (history starts at this migration for older changes). An indicator that has measurements can no longer be deleted: the answer is 409 naming the module and the count.
