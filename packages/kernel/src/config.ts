import { isIP } from 'node:net';
import { z } from 'zod';
import { KernelStartupError } from './errors.ts';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

/** A URL path such as `/` or `/a/b`: no trailing slash (except the root), no empty segments. */
const basePath = z
  .string()
  .regex(
    /^\/([A-Za-z0-9._~-]+(\/[A-Za-z0-9._~-]+)*)?$/,
    'must be "/" or a path like "/a/b" (no trailing slash)',
  );

const origin = z.url().refine((value) => {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value;
  } catch {
    return false;
  }
}, 'must be an origin such as "https://scorpion.example.org" (scheme, host, optional port; no path or trailing slash)');

const databaseUrl = z
  .string()
  .refine(
    (value) => /^postgres(ql)?:\/\/.+/.test(value),
    'must be a postgres:// or postgresql:// URL',
  );

const port = z
  .string()
  .regex(/^\d+$/, 'must be a whole number')
  .transform(Number)
  .pipe(z.number().min(1).max(65535));

/** One address or CIDR range, such as `10.0.0.1`, `10.0.0.0/8` or `fd00::/8`. */
function isAddressOrRange(value: string): boolean {
  const [address, prefix, ...rest] = value.split('/');
  const family = isIP(address ?? '');
  if (family === 0 || rest.length > 0) return false;
  if (prefix === undefined) return true;
  return /^\d{1,3}$/.test(prefix) && Number(prefix) <= (family === 4 ? 32 : 128);
}

/** A comma-separated list of the proxies whose `X-Forwarded-For` the server trusts. Empty: none. */
const trustedProxies = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== ''),
  )
  .superRefine((entries, ctx) => {
    for (const entry of entries) {
      if (!isAddressOrRange(entry)) {
        ctx.addIssue({
          code: 'custom',
          message: 'must be a comma-separated list of IP addresses or CIDR ranges',
        });
        return; // the entry is not echoed back
      }
    }
  });

/** The environment variables the kernel reads. Everything else is configuration in settings. */
const envSchema = z.object({
  DATABASE_URL: databaseUrl,
  PROFILE: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/, 'must be a profile name such as "full"')
    .default('full'),
  PORT: port.default(3000),
  BASE_PATH: basePath.default('/'),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  WORKER_MODE: z.enum(['inline', 'separate']).default('inline'),
  ORIGIN: origin.optional(),
  TRUSTED_PROXIES: trustedProxies.default([]),
});

export type Config = Readonly<Omit<z.output<typeof envSchema>, 'ORIGIN'> & { ORIGIN: string }>;

/**
 * Validates the environment. Stops with the complete list of what is wrong; a value is never
 * echoed back, because `DATABASE_URL` carries a password.
 */
export function loadConfig(env: Record<string, string | undefined>): Config {
  // An empty variable means "not set" (docker compose passes `FOO=` through).
  const present = Object.fromEntries(
    Object.keys(envSchema.shape)
      .filter((key) => env[key] !== undefined && env[key] !== '')
      .map((key) => [key, env[key]]),
  );
  const parsed = envSchema.safeParse(present);
  if (!parsed.success) {
    throw new KernelStartupError(
      'Invalid configuration:',
      parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`,
      ),
    );
  }
  const value = parsed.data;
  return Object.freeze({ ...value, ORIGIN: value.ORIGIN ?? `http://localhost:${value.PORT}` });
}

/** The path prefix routes are mounted under: `''` for the root, else `/a/b`. */
export function mountPath(config: Pick<Config, 'BASE_PATH'>): string {
  return config.BASE_PATH === '/' ? '' : config.BASE_PATH;
}
