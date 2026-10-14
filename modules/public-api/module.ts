import type { SettingsService } from '@scorpion/core-settings/public';
import { defineModule } from '@scorpion/kernel';
import { registerRoutes } from './routes.ts';
import { settingsSchema, type PublicApiSettings } from './settings-schema.ts';

export { settingsSchema, isOrigin, type PublicApiSettings } from './settings-schema.ts';
export { buildSpec } from './service/spec.ts';
export { specRoute } from './routes.ts';

/** The settings module id the pipeline reads the CORS list from (`kernel.settingsOf`). */
export const MODULE_ID = 'public-api';

export type PublicApiDependencies = [SettingsService];

export default defineModule<undefined, 'core.settings', never, PublicApiSettings>({
  id: MODULE_ID,
  version: '0.1.0',
  settings: settingsSchema,
  routes: registerRoutes,
});
