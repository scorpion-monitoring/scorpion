// Validation and normalisation of the organisation's fields. Pure: no database, no network. The Zod
// schemas of the routes and the service both use these functions, so there is one rule per field.
// Everything is plain text. A URL is checked as a string and never fetched.
import { z } from '@scorpion/contracts';

export const MAX_SAME_AS = 20;
export const MAX_URL_LENGTH = 500;
export const MAX_DESCRIPTION_LENGTH = 4000;
export const MAX_NAME_LENGTH = 200;
export const MAX_ABBREVIATION_LENGTH = 64;
export const MAX_EMAIL_LENGTH = 254;
export const MAX_CONTACT_TYPE_LENGTH = 64;

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };
const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const fail = (message: string): Parsed<never> => ({ ok: false, message });

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
// Line breaks and tabs are text in a description; every other control character is not.
// eslint-disable-next-line no-control-regex
const CONTROL_EXCEPT_LAYOUT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;

/** Trimmed, with every run of white space collapsed to one space. */
export function normaliseText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function singleLine(value: string, label: string, min: number, max: number): Parsed<string> {
  if (CONTROL.test(value.replace(/[\t\n\r]/g, ' '))) {
    return fail(`${label} must not contain control characters.`);
  }
  const text = normaliseText(value);
  if (text.length < min) return fail(`${label} must not be empty.`);
  if (text.length > max) return fail(`${label} must be at most ${max} characters.`);
  return ok(text);
}

export const parseName = (value: string) => singleLine(value, 'The name', 1, MAX_NAME_LENGTH);

export function parseAbbreviation(value: string): Parsed<string> {
  const parsed = singleLine(value, 'The abbreviation', 1, MAX_ABBREVIATION_LENGTH);
  if (!parsed.ok) return parsed;
  if (/[\s/]/.test(parsed.value)) {
    return fail('The abbreviation must not contain white space or "/".');
  }
  return parsed;
}

export function parseContactType(value: string): Parsed<string> {
  return singleLine(value, 'The contact type', 1, MAX_CONTACT_TYPE_LENGTH);
}

/** Plain text with its paragraphs: trimmed, line breaks as `\n`. Empty becomes `null`. HTML is text. */
export function parseDescription(value: string): Parsed<string | null> {
  if (CONTROL_EXCEPT_LAYOUT.test(value))
    return fail('The description must not contain control characters.');
  const text = value.replace(/\r\n?/g, '\n').trim();
  if (text.length > MAX_DESCRIPTION_LENGTH) {
    return fail(`The description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`);
  }
  return ok(text === '' ? null : text);
}

/**
 * An `http(s)` URL of at most 500 characters, without credentials and white space. Scheme and host are
 * lower-cased by the URL parser; a lone `/` path is dropped, so `https://example.org/` and
 * `https://example.org` are one value.
 */
export function parseUrl(value: string, label = 'The URL'): Parsed<string> {
  const text = value.trim();
  if (text === '') return fail(`${label} must not be empty.`);
  if (text.length > MAX_URL_LENGTH) {
    return fail(`${label} must be at most ${MAX_URL_LENGTH} characters.`);
  }
  if (/\s/.test(text) || CONTROL.test(text)) {
    return fail(`${label} must not contain white space or control characters.`);
  }
  // The URL parser is lenient (`https:///x` is read as `https://x/`); the input must say what it means.
  if (!/^https?:\/\/[^/\\?#]/i.test(text)) {
    return fail(
      /^[a-z][a-z0-9+.-]*:/i.test(text) && !/^https?:/i.test(text)
        ? `${label} must start with http:// or https://.`
        : `${label} is not a valid URL.`,
    );
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return fail(`${label} is not a valid URL.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return fail(`${label} must start with http:// or https://.`);
  }
  if (url.username !== '' || url.password !== '') {
    return fail(`${label} must not contain credentials.`);
  }
  if (url.hostname === '') return fail(`${label} is not a valid URL.`);
  let href = url.href;
  if (url.pathname === '/' && url.search === '' && url.hash === '') href = href.replace(/\/$/, '');
  if (href.length > MAX_URL_LENGTH) {
    return fail(`${label} must be at most ${MAX_URL_LENGTH} characters.`);
  }
  return ok(href);
}

export const parseWebsite = (value: string) => parseUrl(value, 'The website');

/** At most 20 URLs, each valid; trimmed, normalised, duplicates removed, order kept. */
export function parseSameAs(values: readonly string[]): Parsed<string[]> {
  if (values.length > MAX_SAME_AS) return fail(`At most ${MAX_SAME_AS} links are allowed.`);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const [index, value] of values.entries()) {
    const parsed = parseUrl(value, `Link ${index + 1}`);
    if (!parsed.ok) return parsed;
    if (!seen.has(parsed.value)) {
      seen.add(parsed.value);
      out.push(parsed.value);
    }
  }
  return ok(out);
}

const ROR_BARE = /^0[a-hj-km-np-tv-z0-9]{6}[0-9]{2}$/;
const ROR_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

/** The two check digits of a ROR id (ISO 7064 mod 97-10 over the six base32 characters). */
export function rorChecksum(body: string): string {
  let n = 0n;
  for (const char of body) n = n * 32n + BigInt(ROR_ALPHABET.indexOf(char));
  return String(98n - ((n * 100n) % 97n)).padStart(2, '0');
}

/** The bare, lower-case ROR id from `02skbsp27`, `ror.org/02skbsp27` or `https://ror.org/02skbsp27`. */
export function parseRorId(value: string): Parsed<string> {
  const input = value.trim().toLowerCase();
  const id = input.replace(/^(?:https?:\/\/)?ror\.org\//, '');
  if (!ROR_BARE.test(id)) {
    return fail(
      'The ROR id is not valid: expected 9 characters such as 02skbsp27 or a https://ror.org/ link.',
    );
  }
  if (rorChecksum(id.slice(1, 7)) !== id.slice(7)) {
    return fail('The ROR id is not valid: the check digits do not match.');
  }
  return ok(id);
}

/** The URL of a ROR id, for the profile of sprint 2. */
export const rorUrl = (id: string) => `https://ror.org/${id}`;

const EMAIL_LOCAL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}$/;
const EMAIL_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

/** One syntactically valid address, the domain lower-cased. No DNS or deliverability check. */
export function parseContactEmail(value: string): Parsed<string> {
  const text = value.trim();
  if (text.length > MAX_EMAIL_LENGTH) {
    return fail(`The contact email must be at most ${MAX_EMAIL_LENGTH} characters.`);
  }
  const at = text.lastIndexOf('@');
  const local = text.slice(0, at);
  const domain = text.slice(at + 1).toLowerCase();
  const labels = domain.split('.');
  if (
    at < 1 ||
    !EMAIL_LOCAL.test(local) ||
    local.startsWith('.') ||
    local.endsWith('.') ||
    local.includes('..') ||
    labels.length < 2 ||
    !labels.every((label) => EMAIL_LABEL.test(label))
  ) {
    return fail('The contact email is not a valid address.');
  }
  return ok(`${local}@${domain}`);
}

/** The escape for a `like` pattern (`escape '\'`): a `%`, `_` or `\` in a query is text. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

// ----- Zod schemas for the routes ---------------------------------------------------------------

/** A string that `parse` accepts; the issue message names the field through the path of the schema. */
function checked<T>(parse: (value: string) => Parsed<T>, max: number) {
  return z
    .string()
    .max(max * 4) // a cut-off before any work is done on a huge input; the exact limit is in `parse`
    .transform((value, ctx) => {
      const parsed = parse(value);
      if (!parsed.ok) {
        ctx.issues.push({ code: 'custom', message: parsed.message, input: value });
        return z.NEVER;
      }
      return parsed.value;
    });
}

export const nameSchema = checked(parseName, MAX_NAME_LENGTH);
export const abbreviationSchema = checked(parseAbbreviation, MAX_ABBREVIATION_LENGTH);
export const descriptionSchema = checked(parseDescription, MAX_DESCRIPTION_LENGTH);
export const websiteSchema = checked(parseWebsite, MAX_URL_LENGTH);
export const rorIdSchema = checked(parseRorId, 64);
export const contactEmailSchema = checked(parseContactEmail, MAX_EMAIL_LENGTH);
export const contactTypeSchema = checked(parseContactType, MAX_CONTACT_TYPE_LENGTH);
export const sameAsSchema = z
  .array(z.string().max(MAX_URL_LENGTH * 4))
  .max(MAX_SAME_AS * 2)
  .transform((values, ctx) => {
    const parsed = parseSameAs(values);
    if (!parsed.ok) {
      ctx.issues.push({ code: 'custom', message: parsed.message, input: values });
      return z.NEVER;
    }
    return parsed.value;
  });
