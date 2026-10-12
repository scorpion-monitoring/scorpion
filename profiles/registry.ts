import { defineProfile } from '@scorpion/kernel';

// Profile `registry`: the core modules and the registry modules, without KPI modules (ADR-0032). Target
// of Gate 2 (deployed to staging with real organisation and service data). Published as the image
// `dev-registry` and `<x.y.z>-registry`.
//
// Modules (architecture.md, "Deployment profiles and operations"):
//   Core: core.identity, core.authz, core.settings, core.blob, core.notifications,
//     core.audit, core.ui-shell
//   Registry: registry.organisations (M6); M7 adds registry.services and M8 adds public-api
export default defineProfile({
  name: 'registry',
  modules: [
    'core.authz',
    'core.settings',
    'core.blob',
    'core.notifications',
    'core.identity',
    'core.audit',
    'core.ui-shell',
    'registry.organisations',
  ],
});
