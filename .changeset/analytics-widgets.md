---
'scorpion': minor
---

The dashboard has widgets for the KPIs (profile `full`): KPI cards with the latest value, the change in words and a small chart of the months; a trends chart with a running total, hiding and a second axis for each KPI; the averages; the volatility bars with the band in words; and quick actions. Each has settings (service, range, thematic category) behind the gear in edit mode, and "Dashboard defaults" sets what a new widget starts with. A dashboard reads each service once however many widgets show it. Charts follow the light and dark theme, can be read with the arrow keys and always have a table. New internal route `GET /kpi/analytics/defaults`; the summary answer now carries the monthly points of each KPI; `GET /ui/navigation` lists the settings schema of each widget. The public API is unchanged.
