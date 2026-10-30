import { defineModule } from '@scorpion/kernel';
import { REGISTRIES } from './registries.ts';
import { registerShellRoutes } from './routes.ts';
import { storedDashboardSchema } from './service/dashboard/document.ts';
import {
  createDashboardService,
  DASHBOARD_PREFERENCE,
  PERMISSION_DASHBOARD_READ,
  PERMISSION_DASHBOARD_WRITE,
} from './service/dashboard/service.ts';
import { createAboutService, PERMISSION_ABOUT_READ } from './service/about.ts';
import { createNavigationService } from './service/navigation.ts';
import type { ShellService } from './service/shell.ts';
import { SHELL_NAV, SHELL_ROUTES } from './ui/routes.ts';

export default defineModule<ShellService, 'core.authz' | 'core.settings'>({
  id: 'core.ui-shell',
  displayName: 'Web shell',
  version: '0.1.0',

  // The dashboard is stored in the preference store of core.settings, not in a table of its own (ADR-0042).
  permissions: {
    [PERMISSION_ABOUT_READ]: {
      description: 'See which profile, version and modules this instance runs (About page)',
    },
    [PERMISSION_DASHBOARD_READ]: { description: 'Read your own dashboard' },
    [PERMISSION_DASHBOARD_WRITE]: { description: 'Arrange and save your own dashboard' },
  },

  registries: REGISTRIES,
  contributes: {
    // Every signed-in person has a dashboard of their own; the widgets on it keep their own permissions.
    'authz.defaultRole': [
      {
        role: 'user',
        permissions: [PERMISSION_ABOUT_READ, PERMISSION_DASHBOARD_READ, PERMISSION_DASHBOARD_WRITE],
      },
    ],
    // The stored document. The schema checks the shape and size only: what a tile may be is checked on every
    // read (`parseDashboard`), because the widgets and a person's permissions change.
    'settings.userPreference': [
      {
        key: DASHBOARD_PREFERENCE,
        description: 'Your dashboard: which widgets it shows, where, how big, and their settings',
        schema: storedDashboardSchema,
      },
    ],
    'ui.routes': SHELL_ROUTES,
    'ui.nav': SHELL_NAV,
    // The two themes the shell ships (DaisyUI themes defined in apps/web).
    'ui.theme': [
      { id: 'scorpionlight', label: 'theme.light', colorScheme: 'light' },
      { id: 'scorpiondark', label: 'theme.dark', colorScheme: 'dark' },
    ],
  },

  // The pages themselves (Svelte) are loaded by the web app only; the manifest just names the entry.
  ui: () => import('./ui/index.ts'),

  services: (ctx) => {
    const authz = ctx.deps['core.authz'];
    return {
      ...createNavigationService(ctx, authz),
      ...createAboutService(ctx, authz),
      dashboard: createDashboardService(ctx, { authz, settings: ctx.deps['core.settings'] }),
    };
  },
  routes: (r) => {
    const shell = r.service<ShellService>();
    registerShellRoutes(r, shell, shell.dashboard, shell);
  },
});
