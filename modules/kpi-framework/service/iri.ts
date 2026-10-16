// The IRI of an indicator, a KPI set, a unit, a means of measurement and an automation tool (ADR-0040):
// `<base>/kpi/<kind>/<slug>`. Pure. No free text becomes an IRI: the slug alphabet is fixed and the base is
// checked, so the one function that joins them refuses anything that is not a plain `http(s)` IRI.

export const IRI_KINDS = ['indicator', 'set', 'unit', 'means', 'tool'] as const;
export type IriKind = (typeof IRI_KINDS)[number];

/** The slug of an indicator or a set, and the key of a vocabulary term: letters, digits, `.`, `_` and `-`. */
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** What an IRI must not hold in this system: controls, space and `<>"{}|^` backtick and backslash. */
const FORBIDDEN = /[^\x21-\x7e]|[<>"{}|^`\\]/;
const MAX_BASE_LENGTH = 200;

/**
 * Checks the setting `iriBase`. Empty is valid (the origin of the request is used). Otherwise it must be an
 * absolute `http` or `https` URL with a host, in printable ASCII, without credentials, a query or a fragment.
 * Returns `undefined` when it is fine, or the reason.
 */
export function iriBaseProblem(value: string): string | undefined {
  if (value === '') return undefined;
  if (value.length > MAX_BASE_LENGTH) return `must be at most ${MAX_BASE_LENGTH} characters`;
  if (FORBIDDEN.test(value))
    return 'must be printable ASCII without spaces or any of < > " { } | ^ ` \\';
  if (value.includes('%')) return 'must not contain percent escapes';
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'must be an absolute URL such as https://example.org';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    return 'must start with http:// or https://';
  if (url.hostname === '') return 'must have a host';
  if (url.username !== '' || url.password !== '')
    return 'must not contain a user name or a password';
  if (value.includes('?') || value.includes('#')) return 'must not contain a query or a fragment';
  return undefined;
}

/** Drops every `/` at the end (a loop, not a regular expression: no backtracking on a long run of slashes). */
function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') end--;
  return value.slice(0, end);
}

/** The request the base falls back to: the origin (`https://host:port`) and the base path (`''` or `/x/y`). */
export interface IriRequest {
  origin: string;
  basePath: string;
}

/**
 * The base of every IRI, without a trailing slash: the setting when it is set, otherwise the origin and base
 * path of the request. Correct for one deployment; an IRI that has to survive a move needs the setting.
 * Throws `RangeError` for a value that is not a valid base (a saved setting never is).
 */
export function resolveIriBase(setting: string | null | undefined, request?: IriRequest): string {
  const configured = (setting ?? '').trim();
  const raw =
    configured !== '' ? configured : request ? `${request.origin}${request.basePath}` : '';
  if (raw === '')
    throw new RangeError('no IRI base: set kpi.framework iriBase or give the request');
  const problem = iriBaseProblem(raw);
  if (problem) throw new RangeError(`the IRI base ${JSON.stringify(raw)} ${problem}`);
  return stripTrailingSlashes(raw);
}

/** `<base>/kpi/<kind>/<slug>`. `base` comes from `resolveIriBase`. Throws `RangeError` for a bad kind, slug or base. */
export function iriFor(kind: IriKind, slug: string, base: string): string {
  if (!(IRI_KINDS as readonly string[]).includes(kind))
    throw new RangeError(`unknown IRI kind ${JSON.stringify(kind)}`);
  if (!SLUG.test(slug))
    throw new RangeError(`the slug ${JSON.stringify(slug)} cannot be part of an IRI`);
  const problem = iriBaseProblem(base);
  if (problem !== undefined || base === '')
    throw new RangeError(`the IRI base ${JSON.stringify(base)} ${problem ?? 'is empty'}`);
  return `${stripTrailingSlashes(base)}/kpi/${kind}/${slug}`;
}
