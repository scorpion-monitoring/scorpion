// The settings of matomo (ADR-0054). Nothing secret lives here: the key of the pseudonymous user id is a secret of the
// secrets store (`matomo.user-id-key`), never a setting.
import { z } from '@scorpion/contracts';

/** The longest Matomo address accepted. */
export const MAX_URL_LENGTH = 200;

/**
 * The base address of a Matomo instance: `https:` only, no user, no query, no fragment. A path is allowed (Matomo often
 * lives under `/matomo/`). No wildcard: the origin goes into the page's CSP. Checked by parsing, so an address the browser
 * would read differently is refused.
 */
export function isMatomoUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === '' &&
      !value.includes('?') &&
      !value.includes('#') &&
      !value.includes('*')
    );
  } catch {
    return false;
  }
}

export const settingsSchema = z
  .strictObject({
    enabled: z.boolean().default(false).meta({
      title: 'Track usage with Matomo',
      description:
        'Every page view of this instance is sent to the Matomo instance below: the page as its pattern (/services/:slug), never the address with its ids, query or fragment. Mention it in the privacy policy.',
      order: 1,
    }),
    url: z
      .string()
      .trim()
      .max(MAX_URL_LENGTH)
      .refine(isMatomoUrl, {
        message:
          'Use the https address of the Matomo instance, such as https://stats.example.org/ (a path is fine, no query or fragment).',
      })
      .optional()
      .meta({
        title: 'Matomo address',
        description: 'The base address of the Matomo instance, where matomo.js and matomo.php are.',
        order: 2,
      }),
    siteId: z.number().int().min(1).max(2_147_483_647).optional().meta({
      title: 'Site id',
      description: 'The id Matomo gave this instance (Administration → Websites).',
      order: 3,
    }),
    cookieless: z.boolean().default(true).meta({
      title: 'Without cookies',
      description:
        'Matomo sets no cookie. Visitors are then recognised by a hash of their address and browser: unique visitors per day are a good estimate, over a week or a month they are too high.',
      order: 4,
    }),
    respectDoNotTrack: z.boolean().default(true).meta({
      title: 'Respect Do Not Track',
      description:
        'Nothing is sent from a browser that asks not to be tracked (Do Not Track or Global Privacy Control).',
      order: 5,
    }),
    pseudonymousUserId: z.boolean().default(false).meta({
      title: 'Count signed-in people exactly',
      description:
        'For a signed-in person, send a keyed hash of their account as the Matomo user id, so unique users are exact over any period. Needs the secret matomo.user-id-key (pnpm scorpion set-secret matomo.user-id-key). Pseudonymous personal data: name it in the privacy policy.',
      order: 6,
    }),
  })
  .superRefine((settings, ctx) => {
    if (!settings.enabled) return;
    if (settings.url === undefined) {
      ctx.addIssue({ code: 'custom', path: ['url'], message: 'Needed while tracking is on.' });
    }
    if (settings.siteId === undefined) {
      ctx.addIssue({ code: 'custom', path: ['siteId'], message: 'Needed while tracking is on.' });
    }
  });

export type MatomoSettings = z.output<typeof settingsSchema>;
