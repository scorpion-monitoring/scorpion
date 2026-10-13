import type { MiddlewareHandler } from 'hono';
import { problemResponse, z, type AppEnv } from '@scorpion/contracts';
import type { Kernel, Logger } from '@scorpion/kernel';
import { setResponseHeader } from './request-id.ts';

/** What a browser may send with a call of the public API; fixed, never echoed from the request. */
const ALLOWED_HEADERS = 'Authorization, X-API-Key, Content-Type, X-Request-Id';
/** What a page's script may read from a response: the headers it needs to back off and to report a problem. */
const EXPOSED_HEADERS = 'Retry-After, X-Request-Id';
/** How long a browser may keep a preflight answer (seconds). */
const PREFLIGHT_MAX_AGE = '600';

const storedOrigins = z.object({ corsOrigins: z.array(z.string()) });

/**
 * The origins an administrator allowed: the `corsOrigins` setting of `public-api`. `[]` (same origin
 * only) for anything else, so a missing or broken setting never opens the API to a browser.
 */
export function originsFromSettings(values: unknown): readonly string[] {
  const parsed = storedOrigins.safeParse(values);
  return parsed.success ? parsed.data.corsOrigins : [];
}

/**
 * The allowed origins as the kernel's settings hold them, when the profile has `public-api` (the
 * module that owns the setting); else nothing, and no origin is allowed.
 */
export function corsOriginsOf(kernel: Pick<Kernel, 'profile' | 'settingsOf'>) {
  if (!kernel.profile.modules.some((module) => module.id === 'public-api')) return undefined;
  const settings = kernel.settingsOf('public-api');
  return async () => originsFromSettings(await settings.get());
}

export interface CorsOptions {
  /** `/api/v1` with the base path in front: only paths under it are touched. */
  prefix: string;
  /** The allowed origins, read for every request that carries an `Origin` header (the settings cache makes that cheap). */
  origins: () => Promise<readonly string[]>;
  /** The methods the public API has, for the answer to a preflight. */
  methods: readonly string[];
  log: Logger;
}

function appendVary(c: { res: Response }, ...names: string[]): void {
  const present = (c.res.headers.get('vary') ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  const missing = names.filter(
    (name) => !present.some((have) => have.toLowerCase() === name.toLowerCase()),
  );
  if (missing.length > 0) setResponseHeader(c, 'vary', [...present, ...missing].join(', '));
}

/**
 * Step 2b: CORS for the public API, and only for it. A browser page on an allowed origin may call
 * `/api/v1/*`; every other origin, and every other path, gets no CORS header at all (the call itself is
 * still judged by its token as usual). The rules:
 *
 *  - `Access-Control-Allow-Origin` is the caller's own origin, found in the list by exact comparison;
 *    never `*`, never a pattern, never `null`.
 *  - `Access-Control-Allow-Credentials` is never sent: a v1 call carries a token, not a cookie, and a
 *    page that sends a cookie anyway cannot read the answer.
 *  - Only a preflight (`OPTIONS` with `Access-Control-Request-Method`) under `/api/v1` is answered here:
 *    204 for an allowed origin, 403 without CORS headers for any other. `/api/internal` is never answered.
 *  - The list is read for every request, so a change takes effect without a restart.
 *  - A list that cannot be read allows nobody.
 */
export function cors(options: CorsOptions): MiddlewareHandler<AppEnv> {
  const { prefix, origins, methods, log } = options;
  const allowedMethods = [...new Set([...methods.map((m) => m.toUpperCase()), 'OPTIONS'])].join(
    ', ',
  );

  return async (c, next) => {
    const path = c.req.path;
    const origin = c.req.header('origin');
    if (origin === undefined || !(path === prefix || path.startsWith(`${prefix}/`))) return next();

    let allowed = false;
    try {
      allowed = origin !== 'null' && (await origins()).includes(origin);
    } catch (err) {
      log.warn({ err }, 'could not read the allowed origins; no origin is allowed');
    }

    const preflight =
      c.req.method === 'OPTIONS' && c.req.header('access-control-request-method') !== undefined;
    if (preflight) {
      const vary = 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers';
      if (!allowed) {
        return problemResponse(
          {
            type: 'about:blank',
            title: 'Forbidden',
            status: 403,
            detail: 'This origin is not allowed to call the API from a browser.',
            requestId: c.get('requestId'),
          },
          { vary },
        );
      }
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': origin,
          'access-control-allow-methods': allowedMethods,
          'access-control-allow-headers': ALLOWED_HEADERS,
          'access-control-max-age': PREFLIGHT_MAX_AGE,
          vary,
        },
      });
    }

    await next();
    // The answer depends on the caller's origin, whether or not this one is allowed.
    appendVary(c, 'Origin');
    if (allowed) {
      setResponseHeader(c, 'access-control-allow-origin', origin);
      setResponseHeader(c, 'access-control-expose-headers', EXPOSED_HEADERS);
    }
    return undefined;
  };
}
