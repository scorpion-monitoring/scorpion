import { defineModule } from '@scorpion/kernel';
import type { BlobService } from './public.ts';
import { registerBlobRoutes } from './routes.ts';
import { createBlobService, type BlobInternals } from './service/blobs.ts';
import { createBrandingSync } from './service/branding-sync.ts';
import { PERMISSION_MANAGE, PERMISSION_UPLOAD, USER_PERMISSIONS } from './service/permissions.ts';
import { settingsSchema, type BlobSettings } from './settings-schema.ts';

export { DEFAULT_BLOB_SETTINGS, MAX_UPLOAD_BYTES, settingsSchema } from './settings-schema.ts';
export { FILE_CACHE_CONTROL, FILE_CSP } from './routes.ts';

export interface BlobInternalsBundle extends BlobService {
  blobs: BlobInternals;
}

/**
 * The module as a profile uses it. The service is a closure so the event handlers (fixed in the
 * manifest) reach it; each manifest keeps its own.
 */
export function createBlobModule() {
  let current: BlobInternals | undefined;
  const blobsOrThrow = (): BlobInternals => {
    if (!current) throw new Error('core.blob: the service is not ready');
    return current;
  };
  const branding = createBrandingSync(blobsOrThrow);

  return defineModule<BlobInternalsBundle, 'core.authz' | 'core.settings', never, BlobSettings>({
    id: 'core.blob',
    version: '0.1.0',
    // Short on purpose: the module's tables are `blob_blob`, not `core_blob_blob` (ADR 0004).
    tablePrefix: 'blob_',

    permissions: {
      [PERMISSION_UPLOAD]: {
        description: 'Upload an image through a route of a module that stores it (your avatar)',
      },
      [PERMISSION_MANAGE]: {
        description: 'Upload files such as logos with the generic upload route',
      },
    },
    settings: settingsSchema,

    schema: () => import('./db/schema.ts'),
    migrations: new URL('./migrations', import.meta.url),

    jobs: [
      {
        name: 'core.blob.cleanup',
        schedule: '30 * * * *', // hourly, UTC, off the hour of the identity cleanup
        retry: { limit: 2, delaySeconds: 60 },
        timeoutSeconds: 300,
        handler: async (_job, ctx) => {
          const result = await blobsOrThrow().cleanup();
          // A count only: no id, hash or owner.
          ctx.log.info(result, 'blob cleanup finished');
        },
      },
    ],

    events: {
      on: {
        // The logos are named in the branding settings of core.settings, which cannot call this
        // module (it depends on it the other way round): this module keeps their references in step.
        'settings.changed@1': branding.onSettingsChanged,
        'system.ready': branding.onReady,
      },
    },

    contributes: {
      // Whoever may use a route that stores an image holds `core.blob.upload`; the role `user` does.
      'authz.defaultRole': [{ role: 'user', permissions: USER_PERMISSIONS }],
    },

    services: (ctx) => {
      current = createBlobService(ctx, { authz: ctx.deps['core.authz'] });
      return {
        blobs: current,
        put: (actor, bytes) => current!.put(actor, bytes),
        describe: (id) => current!.describe(id),
        setReference: (ref, blobId) => current!.setReference(ref, blobId),
      };
    },

    routes: (r) => {
      registerBlobRoutes(r, r.service<BlobInternalsBundle>().blobs);
    },
  });
}

export default createBlobModule();
