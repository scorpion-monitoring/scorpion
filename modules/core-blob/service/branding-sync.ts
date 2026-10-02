// Keeps the references of the logos in step with the branding settings (ADR-0018). The logos are
// named by hash in the `branding` settings of core.settings. That module cannot call this one
// (this one depends on it), so this one listens: when `branding` changes, and once at start, it
// reads the effective branding and points `core.settings:branding:logo-<slot>` at the file with
// that hash, or at nothing when the slot is empty or no such file is stored.
import type { Branding } from '@scorpion/core-settings/public';
import type { DomainEvent, EventHandler, ModuleContext } from '@scorpion/kernel';
import type { BlobInternals } from './blobs.ts';

const SLOTS = ['light', 'dark'] as const;
export const logoReference = (slot: (typeof SLOTS)[number]) =>
  `core.settings:branding:logo-${slot}`;

export function createBrandingSync(service: () => BlobInternals) {
  async function sync(ctx: ModuleContext<'core.authz' | 'core.settings'>) {
    const blobs = service();
    const branding: Branding = await ctx.deps['core.settings'].getBranding({ fresh: true });
    for (const slot of SLOTS) {
      const hash = branding.logos[slot];
      const id = hash ? await blobs.idOfHash(hash) : undefined;
      if (hash && !id) {
        // The slot names a hash nobody uploaded: the logo will not show. Which slot, never the hash.
        ctx.log.warn({ slot }, 'a logo in the branding settings names a file that is not stored');
      }
      await blobs.setReference(logoReference(slot), id ?? null);
    }
  }

  const isBrandingChange = (event: DomainEvent) => {
    const payload = event.payload as { module?: unknown; keys?: unknown };
    return (
      payload.module === 'core.settings' &&
      Array.isArray(payload.keys) &&
      payload.keys.includes('branding')
    );
  };

  return {
    onSettingsChanged: (async (event, ctx) => {
      if (isBrandingChange(event)) await sync(ctx as never);
    }) satisfies EventHandler,
    onReady: (async (_event, ctx) => {
      try {
        await sync(ctx as never);
      } catch (err) {
        ctx.log.warn({ err }, 'could not bring the logo references up to date');
      }
    }) satisfies EventHandler,
  };
}
