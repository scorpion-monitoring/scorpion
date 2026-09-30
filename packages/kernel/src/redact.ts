// Secrets never reach a log line. Two layers: pino's `redact` removes fields by name, and
// `maskSecrets` rewrites credentials inside strings (a connection URL in an error message).

const CREDENTIALS_IN_URL = /([a-z][a-z0-9+.-]*:\/\/[^\s:/@]*:)[^\s@/]+@/gi;
const BEARER = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi;
const TOKEN = /\bscp_[A-Za-z0-9]{8}_[A-Za-z0-9_-]+/g;

export const REDACTED = '[redacted]';

/** Field names whose values are removed from every log line, at any depth we list. */
export const REDACTED_PATHS = [
  'password',
  'passwd',
  'secret',
  'token',
  'apiKey',
  'authorization',
  'cookie',
  'databaseUrl',
  'DATABASE_URL',
  'connectionString',
  'SECRETS_KEY',
  '*.password',
  '*.passwd',
  '*.secret',
  '*.token',
  '*.apiKey',
  '*.authorization',
  '*.cookie',
  '*.databaseUrl',
  '*.DATABASE_URL',
  '*.connectionString',
  '*.SECRETS_KEY',
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'headers.authorization',
  'headers.cookie',
  'headers["x-api-key"]',
] as const;

export function maskString(value: string): string {
  return value
    .replace(CREDENTIALS_IN_URL, `$1${REDACTED}@`)
    .replace(BEARER, `$1${REDACTED}`)
    .replace(TOKEN, REDACTED);
}

/** A copy of `value` with credentials masked in every string. Bounded depth; cycles are cut. */
export function maskSecrets(value: unknown, depth = 6, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return maskString(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  if (depth <= 0) return '[truncated]';
  seen.add(value);
  if (value instanceof Error) {
    return {
      type: value.name,
      message: maskString(value.message),
      stack: value.stack ? maskString(value.stack) : undefined,
      ...(value.cause === undefined ? {} : { cause: maskSecrets(value.cause, depth - 1, seen) }),
    };
  }
  if (Array.isArray(value)) return value.map((item) => maskSecrets(item, depth - 1, seen));
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, maskSecrets(item, depth - 1, seen)]),
  );
}
