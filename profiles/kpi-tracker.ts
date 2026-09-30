import { defineProfile } from '@scorpion/kernel';

// Profile `kpi-tracker`: KPI collection and analytics. Target of Gate 3.
// Needs registry.services because KPIs attach to services; the catalogue UI can be hidden
// through a setting.
//
// Modules (architecture.md, "Deployment profiles and operations"), added from M2 on:
//   Core (all profiles): core.identity, core.authz, core.settings, core.notifications,
//     core.audit, core.ui-shell
//   Registry: registry.organisations, registry.services
//   KPIs: kpi.framework, kpi.ingestion, kpi.analytics
//   Other: backup, public-api
//   Optional: kpi.impact, bibliometrics, announcements
export default defineProfile({
  name: 'kpi-tracker',
  modules: [],
});
