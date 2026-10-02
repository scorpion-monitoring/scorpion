import { z } from '@scorpion/contracts';
import { defineModule, KernelStartupError } from '@scorpion/kernel';
import type { SettingsService } from './public.ts';
import { registerSettingsRoutes } from './routes.ts';
import { createRotateSecretsCommand, createSetSecretCommand } from './service/commands.ts';
import { loadKeyRing } from './service/crypto.ts';
import {
  PERMISSION_PREFERENCE_READ,
  PERMISSION_PREFERENCE_WRITE,
  PERMISSION_SECRET_WRITE,
  PERMISSION_SETTINGS_READ,
  PERMISSION_SETTINGS_WRITE,
  USER_PERMISSIONS,
} from './service/permissions.ts';
import {
  createPreferencesService,
  USER_PREFERENCE_REGISTRY,
  userPreferenceEntrySchema,
  type PreferencesService,
} from './service/preferences.ts';
import { createSecretsService, type Cipher, type SecretsInternals } from './service/secrets.ts';
import { createSettingsService, type SettingsInternals } from './service/settings.ts';

import { settingsSchema, type CoreSettings } from './settings-schema.ts';

export { settingsSchema, DEFAULT_RATE_LIMITS, type CoreSettings } from './settings-schema.ts';

export interface SettingsInternalsBundle extends SettingsService {
  settings: SettingsInternals;
  secrets: SecretsInternals;
  preferences: PreferencesService;
}

export interface SettingsModuleOptions {
  /** For tests: how long one process trusts the stored settings it has read. */
  cacheTtlMs?: number;
  /** For tests: the clock of the cache. */
  now?: () => number;
  /** Where `SECRETS_KEY` and `SECRETS_KEY_NEXT` are read from. Default: the process environment. */
  env?: Record<string, string | undefined>;
  /** For tests: replaces the AES-GCM implementation, to prove a failed verification changes nothing. */
  cipher?: Cipher;
}

const changed = z.strictObject({
  module: z.string(),
  // Names of the keys that changed, never their values.
  keys: z.array(z.string()).min(1),
  version: z.number().int(),
});

/**
 * Builds the manifest. The default export is the one a profile uses; tests build their own to tune
 * the cache and to supply keys. The settings store entry is fixed in the manifest and reaches the
 * service through a closure.
 */
export function createSettingsModule(options: SettingsModuleOptions = {}) {
  let current: SettingsInternalsBundle | undefined;
  const bundleOrThrow = (): SettingsInternalsBundle => {
    if (!current) throw new Error('core.settings: the service is not ready');
    return current;
  };

  return defineModule<SettingsInternalsBundle, 'core.authz', never, CoreSettings>({
    id: 'core.settings',
    version: '0.1.0',
    // Short on purpose: the module's tables are `settings_setting`, not `core_settings_setting` (ADR 0004).
    tablePrefix: 'settings_',

    permissions: {
      [PERMISSION_SETTINGS_READ]: {
        description: 'Read the settings of every module and the names of the secrets',
      },
      [PERMISSION_SETTINGS_WRITE]: { description: 'Change the settings of a module' },
      [PERMISSION_SECRET_WRITE]: {
        description: 'Set and remove secrets (they can never be read back)',
      },
      [PERMISSION_PREFERENCE_READ]: { description: 'Read your own preferences' },
      [PERMISSION_PREFERENCE_WRITE]: { description: 'Change your own preferences' },
    },
    settings: settingsSchema,

    schema: () => import('./db/schema.ts'),
    migrations: new URL('./migrations', import.meta.url),

    commands: [
      createSetSecretCommand(() => bundleOrThrow().secrets),
      createRotateSecretsCommand(() => bundleOrThrow().secrets),
    ],

    events: {
      emits: {
        'settings.changed@1': changed,
        // The name of the secret and whether it went; never the value, the key or its id.
        'settings.secret.changed@1': z.strictObject({ name: z.string(), removed: z.boolean() }),
        // Which preference of which user, never what it was set to.
        'settings.preference.changed@1': z.strictObject({
          userId: z.string(),
          key: z.string(),
          removed: z.boolean(),
        }),
      },
    },

    registries: { [USER_PREFERENCE_REGISTRY]: userPreferenceEntrySchema },
    contributes: {
      // Preferences are self-service: the role `user` holds them. Everything else is Admin's, by resolution.
      'authz.defaultRole': [{ role: 'user', permissions: USER_PERMISSIONS }],
      'kernel.settingsStore': [
        { read: (moduleId: string) => bundleOrThrow().settings.store.read(moduleId) },
      ],
    },

    services: (ctx) => {
      // A profile with this module refuses to start without a valid key (ADR 0016). The message says
      // how to make one and never repeats what was set.
      const { ring, problems } = loadKeyRing(options.env ?? process.env);
      if (!ring) throw new KernelStartupError('Cannot start core.settings:', problems);
      const authz = ctx.deps['core.authz'];
      const settings = createSettingsService(ctx, { authz }, options);
      const secrets = createSecretsService(ctx, { authz, keys: ring, cipher: options.cipher });
      current = {
        settings,
        secrets,
        preferences: createPreferencesService(ctx, { authz }),
        getSecret: (name) => secrets.getSecret(name),
      };
      return current;
    },

    routes: (r) => {
      const { settings, secrets, preferences } = r.service<SettingsInternalsBundle>();
      registerSettingsRoutes(r, { settings, secrets, preferences });
    },
  });
}

export default createSettingsModule();
