---
'scorpion': patch
---

Dashboard widgets are easier to read:

- The KPI cards, averages, volatility and trends widgets show only the KPIs of the service's KPI set (the set of its category and the
  optional KPIs it chose) that have values in the chosen range, instead of a row of "n/a" for each KPI without data. One line under
  the widget names the KPIs left out. KPIs the service no longer reports are not shown; their values stay in the CSV and XLSX export.
- The trends chart uses a fixed palette of eight distinct colours per theme, a marker shape per KPI and a dashed line for KPIs on the
  right axis, and a KPI keeps its colour when another is hidden. The legend sits under the chart and wraps on narrow screens instead
  of overlapping the axis; an exported PNG or SVG includes it.
- The membership requests card always says something: how many requests wait for your decision (or that none do), and your own open
  requests or memberships, with a link to find your organisation.
