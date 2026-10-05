import { defineProfile } from '@scorpion/kernel';

// Profile `full`: every module. Target of Gate 4.
//
// Modules (architecture.md, "Deployment profiles and operations"), added from M2 on:
//   Core (all profiles): core.identity, core.authz, core.settings, core.notifications,
//     core.audit, core.ui-shell
//   Registry: registry.organisations, registry.services
//   KPIs: kpi.framework, kpi.ingestion, kpi.analytics, kpi.impact
//   Parity: maturity, onboarding, bibliometrics, network-graph, announcements
//   Operations: backup, public-api
export default defineProfile({
  name: 'full',
  modules: [
    'core.authz',
    'core.settings',
    'core.blob',
    'core.notifications',
    'core.identity',
    'core.audit',
  ],
});
