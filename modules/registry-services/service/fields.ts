// Validation and normalisation of the service's own fields. Pure: no database, no network. The URL,
// `sameAs`, description, name and contact rules are the organisation's, imported through its `public.ts`
// (one normaliser, not a copy that can drift); the slug is this module's.
import {
  parseContactEmail,
  parseContactType,
  parseDescription,
  parseName,
  parseSameAs,
  parseUrl,
  type Parsed,
} from '@scorpion/registry-organisations/public';

export {
  MAX_CONTACT_TYPE_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_EMAIL_LENGTH,
  MAX_NAME_LENGTH,
  MAX_SAME_AS,
  MAX_URL_LENGTH,
  escapeLike,
  parseContactEmail,
  parseContactType,
  parseDescription,
  parseName,
  parseSameAs,
  parseUrl,
  type Parsed,
} from '@scorpion/registry-organisations/public';

export const MAX_SLUG_LENGTH = 64;
export const SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Words that the page routes use below `/services/` (and the internal API below `/services`): a slug
 * with one of them would be unreachable or ambiguous. Compared without case.
 */
export const RESERVED_SLUGS: readonly string[] = [
  'new',
  'facets',
  'schema',
  'by-slug',
  'public',
  'edit',
];

/**
 * A slug: letters, digits, dot, underscore and hyphen, at most 64, starting with a letter or digit, **not
 * shaped like a UUID** (so `/services/{id}` and `/services/{slug}` cannot clash) and not a reserved page
 * word. The case is kept; uniqueness ignores it.
 */
export function parseSlug(value: string): Parsed<string> {
  const text = value.trim();
  if (text === '') return { ok: false, message: 'The slug must not be empty.' };
  if (text.length > MAX_SLUG_LENGTH) {
    return { ok: false, message: `The slug must be at most ${MAX_SLUG_LENGTH} characters.` };
  }
  if (!SLUG_PATTERN.test(text)) {
    return {
      ok: false,
      message:
        'The slug may contain letters, digits, ".", "_" and "-", and must start with a letter or a digit.',
    };
  }
  if (UUID_SHAPE.test(text)) {
    return { ok: false, message: 'The slug must not look like an id (a UUID).' };
  }
  if (RESERVED_SLUGS.includes(text.toLowerCase())) {
    return { ok: false, message: `"${text}" is reserved and cannot be used as a slug.` };
  }
  return { ok: true, value: text };
}

/** The set of names a text field of `format` accepts; see `field-types.ts`. */
export const TEXT_FORMATS = [
  'plain',
  'slug',
  'name',
  'description',
  'url',
  'email',
  'contact-type',
] as const;
export type TextFormat = (typeof TEXT_FORMATS)[number];

const PLAIN_MAX = 500;

/** `plain`: one line of text, trimmed, at most `max` characters, without control characters. */
export function parsePlain(value: string, max = PLAIN_MAX): Parsed<string> {
  const parsed = parseName(value);
  if (!parsed.ok) return { ok: false, message: parsed.message.replace('The name', 'The value') };
  if (parsed.value.length > max) {
    return { ok: false, message: `The value must be at most ${max} characters.` };
  }
  return parsed;
}

/** Parsers by format. A parser returns `null` for an empty description, which the caller treats as "not set". */
export const TEXT_PARSERS: Record<TextFormat, (value: string) => Parsed<string | null>> = {
  plain: (value) => parsePlain(value),
  slug: parseSlug,
  name: parseName,
  description: parseDescription,
  url: (value) => parseUrl(value),
  email: parseContactEmail,
  'contact-type': parseContactType,
};

/** The list rule of `sameAs`: each valid, normalised, duplicates removed, at most 20. */
export const parseUrlList = (values: readonly string[]): Parsed<string[]> => parseSameAs(values);
