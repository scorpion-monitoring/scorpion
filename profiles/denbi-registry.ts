// Profile `denbi-registry`: the de.NBI service registry with KPIs. Target of Gate 2
// (first deployed without the KPI modules).
//
// Modules (architecture.md, "Deployment profiles and operations"), added from M1 on:
//   Core (all profiles): core.identity, core.authz, core.settings, core.notifications,
//     core.audit, core.ui-shell
//   Registry: registry.organisations, registry.services
//   KPIs: kpi.framework, kpi.ingestion, kpi.analytics, kpi.impact
//   Other: bibliometrics, network-graph, announcements, backup, public-api
//   Optional: maturity, onboarding
export default {
  name: 'denbi-registry',
  modules: [],
};
