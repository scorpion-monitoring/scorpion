// The settings of public-api. Nothing secret lives here.
import { z } from '@scorpion/contracts';

/** At most this many allowed origins: the list is read for every request that carries an `Origin` header. */
export const MAX_CORS_ORIGINS = 50;

/**
 * An origin as a browser sends it in `Origin`: scheme, host and optional port, nothing else. Checked by
 * parsing, and it must equal what the parser makes of it, so `https://Example.org`, `https://a.org/`
 * and `https://a.org/path` are refused instead of silently never matching. No wildcard, no `null`.
 */
export function isOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      url.origin === value &&
      !value.includes('*')
    );
  } catch {
    return false;
  }
}

const origin = z.string().max(255).refine(isOrigin, {
  message:
    'Use an origin such as https://app.example.org: scheme, host and port, no path, no wildcard.',
});

export const settingsSchema = z.strictObject({
  corsOrigins: z.array(origin).max(MAX_CORS_ORIGINS).default([]).meta({
    title: 'Allowed origins for browsers',
    description:
      'Web pages on these origins may call the public API (/api/v1) from the browser. Empty means same origin only. A change takes effect at once. Credentials (cookies) are never allowed; a call carries a token.',
  }),
  specTitle: z.string().trim().min(1).max(100).optional().meta({
    title: 'Title of the API description',
    description: 'The title in /api/v1/openapi.json. Default: "Public API".',
  }),
  specDescription: z.string().trim().min(1).max(1000).optional().meta({
    title: 'Description of the API',
    description: 'The description in /api/v1/openapi.json. Default: "The public API, version 1."',
  }),
  contactName: z.string().trim().min(1).max(100).optional().meta({
    title: 'Contact name',
    description: 'Who to ask about the API, shown in /api/v1/openapi.json.',
  }),
  contactEmail: z.email().max(254).optional().meta({
    title: 'Contact email',
    description: 'Shown in /api/v1/openapi.json.',
  }),
  contactUrl: z
    .url({ protocol: /^https?$/ })
    .max(2048)
    .optional()
    .meta({
      title: 'Contact URL',
      description: 'A page about the API, shown in /api/v1/openapi.json.',
    }),
});

export type PublicApiSettings = z.output<typeof settingsSchema>;
