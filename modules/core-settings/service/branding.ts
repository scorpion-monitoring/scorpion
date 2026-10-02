// Branding: what the instance calls itself, who its mail comes from, its logos and legal texts. The
// values are the `branding` key of the settings of core.settings, saved through the generic settings
// routes. Other modules read the effective values through the public `getBranding()` (ADR-0018):
// `ctx.settings` is a module's own, and this is the one module everything may depend on.
import { createHash } from 'node:crypto';
import { resolveSettings } from '@scorpion/kernel';
import { renderMarkdown } from '@scorpion/sanitize';
import {
  DEFAULT_MAIL_FROM,
  LEGAL_PAGES,
  settingsSchema,
  type CoreSettings,
  type LegalPage,
} from '../settings-schema.ts';
import type { Branding } from '../public.ts';
import type { SettingsInternals } from './settings.ts';

export { LEGAL_PAGES, type Branding, type LegalPage };

export interface LegalDocument {
  page: LegalPage;
  title: string;
  /** Sanitised HTML rendered from the Markdown text. */
  html: string;
}

export interface BrandingService {
  /** The effective branding. `fresh` skips this process's cache (for a handler that reacts to a change). */
  get(options?: { fresh?: boolean }): Promise<Branding>;
  /** The rendered legal page, or `undefined` when no text was written for it. */
  legal(page: LegalPage): Promise<LegalDocument | undefined>;
}

const TITLES: Record<LegalPage, string> = {
  terms: 'Terms of use',
  privacy: 'Privacy policy',
  imprint: 'Imprint',
};

const RENDER_CACHE_SIZE = 16;

export function createBrandingService(settings: SettingsInternals): BrandingService {
  // Rendering is the expensive part; the key is the text itself (hashed), so an edit is a new entry.
  const rendered = new Map<string, string>();

  async function read(fresh: boolean): Promise<CoreSettings['branding']> {
    const stored = fresh
      ? await settings.readFresh('core.settings')
      : await settings.store.read('core.settings');
    return (resolveSettings(settingsSchema, stored).value as CoreSettings).branding;
  }

  return {
    async get(options = {}) {
      const branding = await read(options.fresh === true);
      return {
        productName: branding.productName,
        instanceName: branding.instanceName ?? branding.productName,
        mailFrom: branding.mailFrom ?? DEFAULT_MAIL_FROM,
        contactEmail: branding.contactEmail ?? null,
        imprintUrl: branding.imprintUrl ?? null,
        logos: { light: branding.logos.light ?? null, dark: branding.logos.dark ?? null },
        legalPages: LEGAL_PAGES.filter((page) => (branding.legal[page] ?? '').trim() !== ''),
      };
    },

    async legal(page) {
      const text = (await read(false)).legal[page];
      if (text === undefined || text.trim() === '') return undefined;
      const key = `${page}:${createHash('sha256').update(text).digest('hex')}`;
      let html = rendered.get(key);
      if (html === undefined) {
        html = renderMarkdown(text);
        if (rendered.size >= RENDER_CACHE_SIZE) rendered.delete(rendered.keys().next().value!);
        rendered.set(key, html);
      }
      return { page, title: TITLES[page], html };
    },
  };
}
