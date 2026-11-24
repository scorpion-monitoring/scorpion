---
'scorpion': minor
---

Dashboards can be shared as a file. "Export dashboard" in the dashboard menu saves your dashboard as a `.json` file (its widgets, places, sizes and settings, nothing personal); "Import dashboard" replaces your dashboard with the one in such a file, after asking. Widgets you cannot see or that this instance does not have are left out, and the page says how many. The settings of the KPI widgets (service, range, category) now open from a gear in the widget's heading without customising the dashboard first. The default dashboard now also shows the volatility bars next to the KPI cards and trends; dashboards people have already saved are not changed (use "Reset to default" to get the new default). Internal API: new `POST /ui/dashboard/import`.
