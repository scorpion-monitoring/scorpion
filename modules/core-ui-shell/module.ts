import { defineModule } from '@scorpion/kernel';
import type { AuthzService } from '@scorpion/core-authz/public';
import { REGISTRIES } from './registries.ts';
import { registerShellRoutes } from './routes.ts';
import { createNavigationService, type NavigationService } from './service/navigation.ts';
import { SHELL_NAV, SHELL_ROUTES } from './ui/routes.ts';

export type AuthzOnly = [AuthzService];

export default defineModule<NavigationService, 'core.authz'>({
  id: 'core.ui-shell',
  version: '0.1.0',

  registries: REGISTRIES,
  contributes: {
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

  services: (ctx) => createNavigationService(ctx, ctx.deps['core.authz']),
  routes: (r) => registerShellRoutes(r, r.service<NavigationService>()),
});
