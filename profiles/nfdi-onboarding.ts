import { defineProfile } from '@scorpion/kernel';

// Profile `nfdi-onboarding`: NFDI service onboarding with maturity assessment.
//
// Modules (architecture.md, "Deployment profiles and operations"), added from M2 on:
//   Core (all profiles): core.identity, core.authz, core.settings, core.notifications,
//     core.audit, core.ui-shell
//   Registry: registry.organisations, registry.services
//   Other: maturity, onboarding, backup
//   Optional: kpi.framework, kpi.ingestion, kpi.analytics, announcements, public-api
export default defineProfile({
  name: 'nfdi-onboarding',
  modules: [],
});
