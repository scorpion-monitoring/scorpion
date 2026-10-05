// What the audit trail may store of a request or a payload (ADR 0021): the secret-looking keys are
// replaced, the JSON is cut to a size, and nothing that Postgres' jsonb would refuse is let through
// (a refused insert would be a gap in the trail that an attacker could cause).
export const REDACTED = '[redacted]';

/** Key names whose value is never stored. A key matches when its normalised form equals or ends with one of these. */
export const DEFAULT_REDACT_KEYS: readonly string[] = [
  'password',
  'token',
  'secret',
  'authorization',
  'apikey',
  'code',
  'value',
];

/**
 * The names hidden in the payload of a domain event. Without `code` and `value`: an event carries an
 * error code or a template key, never a user's value, and the code is what an operator needs to see.
 * (No declared event has a secret-named field at all; a test proves it.)
 */
export const EVENT_REDACT_KEYS: readonly string[] = DEFAULT_REDACT_KEYS.filter(
  (key) => key !== 'code' && key !== 'value',
);

/** The largest JSON text stored in `query`, `body` or `payload`, in bytes. */
export const MAX_STORED_BYTES = 8 * 1024;
const MAX_DEPTH = 12;

/** `Api-Key`, `api_key` and `apiKey` are one name: lower case, letters and digits only. */
export function normaliseKey(key: string): string {
  return key.toLowerCase().replaceAll(/[^a-z0-9]/g, '');
}

/**
 * Matches a key against the names to hide. A suffix counts (`newPassword`, `csrfToken`,
 * `clientSecret`, `x-api-key`), so a longer name for a secret is caught; `values` and `tokenId` are not.
 */
export function isSecretKey(key: string, names: readonly string[]): boolean {
  const normalised = normaliseKey(key);
  if (normalised === '') return false;
  return names.some((name) => normalised === name || normalised.endsWith(name));
}

/** Postgres' jsonb refuses U+0000 and unpaired surrogates; both are replaced, in keys as in values. */
function clean(text: string): string {
  return text.toWellFormed().replaceAll('\u0000', '�');
}

/**
 * A copy of `input` with every secret-looking key's value replaced by `[redacted]`, at any depth, in
 * objects and arrays. `extra` is the route's own list. Strings are made safe for jsonb. Nesting
 * deeper than 12 levels is replaced, so a hostile body cannot make the walk expensive.
 */
export function redact(
  input: unknown,
  extra: readonly string[] = [],
  base: readonly string[] = DEFAULT_REDACT_KEYS,
): unknown {
  return walk(input, [...base, ...extra.map(normaliseKey)], 0);
}

function walk(input: unknown, names: readonly string[], depth: number): unknown {
  if (typeof input === 'string') return clean(input);
  if (input === null || typeof input !== 'object') {
    if (typeof input === 'number' && !Number.isFinite(input)) return null;
    if (typeof input === 'bigint') return input.toString();
    if (typeof input === 'function' || typeof input === 'symbol') return null;
    return input;
  }
  if (depth >= MAX_DEPTH) return '[too deep]';
  if (input instanceof Date) return input.toISOString();
  if (Array.isArray(input)) return input.map((item) => walk(item, names, depth + 1));
  // `fromEntries` defines own properties, so a key named `__proto__` stays data.
  return Object.fromEntries(
    Object.entries(input).map(([key, item]) => [
      clean(key),
      isSecretKey(key, names) ? REDACTED : walk(item, names, depth + 1),
    ]),
  );
}

/** Keeps at most `bytes` bytes of `text`, without cutting a character in half. */
function prefixBytes(text: string, bytes: number): string {
  const buffer = Buffer.from(text, 'utf8');
  if (buffer.length <= bytes) return text;
  return buffer.subarray(0, Math.max(bytes, 0)).toString('utf8').replace(/�+$/, '');
}

export interface Capped {
  value: unknown;
  truncated: boolean;
}

/**
 * Keeps `value` when its JSON text fits in `max` bytes. Otherwise stores a stand-in that is valid
 * JSON and also fits: `{ "_truncated": true, "preview": "<the first part of the JSON text>" }`.
 */
export function capJson(value: unknown, max = MAX_STORED_BYTES): Capped {
  if (value === undefined) return { value: undefined, truncated: false };
  const text = JSON.stringify(value) ?? 'null';
  if (Buffer.byteLength(text) <= max) return { value, truncated: false };
  let keep = max - 48;
  for (;;) {
    const stand = { _truncated: true, preview: prefixBytes(text, keep) };
    if (Buffer.byteLength(JSON.stringify(stand)) <= max || keep <= 0) {
      return { value: stand, truncated: true };
    }
    keep = Math.floor(keep * 0.8);
  }
}

/** Redacts, then caps: the one function the sink uses for a body, a query and a payload. */
export function prepare(
  value: unknown,
  extra: readonly string[] = [],
  base: readonly string[] = DEFAULT_REDACT_KEYS,
): Capped {
  if (value === undefined) return { value: undefined, truncated: false };
  return capJson(redact(value, extra, base));
}

/** A text column value: well-formed, no NUL, at most `max` characters; `null` when empty. */
export function cleanText(value: string | null | undefined, max: number): string | null {
  if (value === null || value === undefined) return null;
  const text = clean(value).slice(0, max);
  return text === '' ? null : text;
}
