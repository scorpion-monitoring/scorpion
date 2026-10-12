// The Schema.org `Organization` profile of an organisation (ADR-0033, plan §3). Pure: no database, no
// settings, no network. One function builds the object and one function turns it into the string that
// may go into an HTML `<script type="application/ld+json">` block; nothing else in the module builds
// HTML from organisation data.
import type { SchemaType } from './registries.ts';

/** What the profile needs of an organisation, as stored. */
export interface SchemaOrgSource {
  id: string;
  /** The `schemaType` of the organisation's `org.type` entry. */
  schemaType: SchemaType;
  abbreviation: string;
  name: string;
  description: string | null;
  website: string | null;
  /** The bare ROR id (`02skbsp27`). */
  rorId: string | null;
  sameAs: readonly string[];
  logoHash: string | null;
  contactEmail: string | null;
  contactType: string | null;
}

export interface SchemaOrgOptions {
  /** The instance origin, `https://scorpion.example.org`, no trailing slash. */
  origin: string;
  /** The mount path: `''`, `'/'` or `/a/b`. */
  basePath: string;
  /** Whether the reader may see the contact point (the caller decides; a trusted caller says false). */
  includeContact: boolean;
}

export interface SchemaOrgProfile {
  '@context': 'https://schema.org';
  '@type': SchemaType;
  '@id': string;
  name: string;
  alternateName?: string;
  description?: string;
  url: string;
  identifier?: { '@type': 'PropertyValue'; propertyID: 'ROR'; value: string };
  sameAs?: string[];
  logo?: { '@type': 'ImageObject'; url: string };
  contactPoint?: { '@type': 'ContactPoint'; email: string; contactType: string };
}

export const ROR_URL_PREFIX = 'https://ror.org/';

/** `''` for the root, else `/a/b` without a trailing slash. */
function mount(basePath: string): string {
  const trimmed = basePath.replace(/\/+$/, '');
  return trimmed === '' || trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

const nonEmpty = (value: string | null | undefined): value is string =>
  value !== null && value !== undefined && value.trim() !== '';

/** The absolute URL of the detail page of an organisation; also its `@id`. */
export function organisationUrl(
  id: string,
  options: Pick<SchemaOrgOptions, 'origin' | 'basePath'>,
) {
  return `${options.origin.replace(/\/+$/, '')}${mount(options.basePath)}/organisations/${id}`;
}

/** The URL a logo is served at; the file route is public and the hash is of the stored bytes. */
export function logoUrl(hash: string, options: Pick<SchemaOrgOptions, 'origin' | 'basePath'>) {
  return `${options.origin.replace(/\/+$/, '')}${mount(options.basePath)}/api/internal/files/${hash}`;
}

/** Builds the profile. A property without a value is left out, never `null` or an empty string. */
export function toSchemaOrg(source: SchemaOrgSource, options: SchemaOrgOptions): SchemaOrgProfile {
  const self = organisationUrl(source.id, options);
  const ror = nonEmpty(source.rorId) ? `${ROR_URL_PREFIX}${source.rorId}` : undefined;
  // The ROR URL is a `sameAs` entry once, whether or not the stored list repeats it.
  const sameAs = [...new Set([...(ror ? [ror] : []), ...source.sameAs.filter(nonEmpty)])];
  return {
    '@context': 'https://schema.org',
    '@type': source.schemaType,
    '@id': self,
    name: source.name,
    ...(nonEmpty(source.abbreviation) && { alternateName: source.abbreviation }),
    ...(nonEmpty(source.description) && { description: source.description }),
    // The organisation's own site; the `@id` identifies the record, so it is the fallback.
    url: nonEmpty(source.website) ? source.website : self,
    ...(ror && { identifier: { '@type': 'PropertyValue', propertyID: 'ROR', value: ror } }),
    ...(sameAs.length > 0 && { sameAs }),
    ...(nonEmpty(source.logoHash) && {
      logo: { '@type': 'ImageObject', url: logoUrl(source.logoHash, options) },
    }),
    ...(options.includeContact &&
      nonEmpty(source.contactEmail) &&
      nonEmpty(source.contactType) && {
        contactPoint: {
          '@type': 'ContactPoint',
          email: source.contactEmail,
          contactType: source.contactType,
        },
      }),
  };
}

// `<`, `>` and `&` end a script block or start a comment; U+2028 and U+2029 end a line in older
// JavaScript parsers. Written as `\uXXXX` they stay valid JSON with the same value.
const UNSAFE = /[<>&\u2028\u2029]/g;

/**
 * The only way a profile becomes a string for HTML: `JSON.stringify`, then every character that could
 * end the `<script>` block or open a comment is written as a `\u` escape. The result contains no `<`.
 * (`JSON.stringify` already writes a lone surrogate as `\udXXX`.)
 */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(
    UNSAFE,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}
