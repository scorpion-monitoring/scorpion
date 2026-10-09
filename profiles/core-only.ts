import { defineProfile } from '@scorpion/kernel';

// Profile `core-only`: the core modules and nothing else. Target of Gate 1 (deployed to
// staging as the security foundation). Later profiles add registry and KPI modules on top.
//
// Modules (architecture.md, "Deployment profiles and operations"):
//   Core: core.identity, core.authz, core.settings, core.blob, core.notifications,
//     core.audit, core.ui-shell
export default defineProfile({
  name: 'core-only',
  modules: [
    'core.authz',
    'core.settings',
    'core.blob',
    'core.notifications',
    'core.identity',
    'core.audit',
    'core.ui-shell',
  ],
});
