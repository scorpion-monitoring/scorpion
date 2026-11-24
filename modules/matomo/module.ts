import { defineModule } from '@scorpion/kernel';
import { registerRoutes } from './routes.ts';
import { createTrackerService, type TrackerService } from './service/tracker.ts';
import { settingsSchema, type MatomoSettings } from './settings-schema.ts';
import { MATOMO_WIDGETS } from './ui/routes.ts';

export { settingsSchema, isMatomoUrl, type MatomoSettings } from './settings-schema.ts';

/** The module id, which is also the settings key and the start of its secret's name. */
export const MODULE_ID = 'matomo';

export default defineModule<TrackerService, 'core.settings', never, MatomoSettings>({
  id: MODULE_ID,
  displayName: 'Usage statistics (Matomo)',
  version: '0.1.0',

  // No table, no permission of its own: the settings are edited with core.settings.write in the settings form, and the
  // key of the pseudonymous id with core.settings.secret.write (ADR-0054).
  settings: settingsSchema,

  contributes: {
    'ui.widget': MATOMO_WIDGETS,
  },
  ui: () => import('./ui/index.ts'),

  services: (ctx) => {
    const settings = ctx.deps['core.settings'];
    return createTrackerService({
      settings: () => ctx.settings.get(),
      secret: (name) => settings.getSecret(name),
      log: ctx.log,
    });
  },
  routes: registerRoutes,
});
