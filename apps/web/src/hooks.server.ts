import type { Handle, HandleServerError } from '@sveltejs/kit/hooks';
import { ApiError } from '@scorpion/contracts/client';
import {
  clientFor,
  createBootstrapProbe,
  loadLocale,
  loadNavigation,
  loadSession,
  once,
} from '#lib/server/session.ts';

const needsFirstAdmin = createBootstrapProbe();

/**
 * Hardening that applies to every response of the web app. The Content-Security-Policy is set by
 * SvelteKit (nonces, no 'unsafe-inline'; see vite.config.ts). `Cache-Control: no-store` keeps a page
 * that carries the caller's session out of shared caches; built assets keep their own long cache.
 */
const HEADERS: Readonly<Record<string, string>> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
};

export const handle: Handle = async ({ event, resolve }) => {
  const api = clientFor(event.request);
  event.locals.api = api;
  event.locals.session = once(() => loadSession(api, event.request.headers.get('cookie') ?? ''));
  event.locals.navigation = once(() => loadNavigation(api));
  event.locals.bootstrap = once(() => needsFirstAdmin(api));
  event.locals.locale = once(async () =>
    loadLocale(api, await event.locals.session(), event.request.headers.get('accept-language')),
  );

  const response = await resolve(event, {
    // The document's language is the page's (`<html lang="%lang%">` in app.html). The error page of a
    // request whose API calls failed stays English: it must not fail again for want of a language.
    transformPageChunk: async ({ html }) =>
      html.includes('%lang%')
        ? html.replace('%lang%', await event.locals.locale().catch(() => 'en'))
        : html,
  });
  for (const [name, value] of Object.entries(HEADERS)) {
    if (!response.headers.has(name)) response.headers.set(name, value);
  }
  if (!response.headers.has('cache-control')) response.headers.set('cache-control', 'no-store');
  return response;
};

/**
 * What the visitor sees of a failure: a message, never a stack or an upstream detail. An error a loader
 * raised on purpose (`error(404, …)`, kind `app`) keeps its message; an `ApiError` that got out, or
 * anything else unexpected, is reduced to a safe one and logged.
 */
export const handleError: HandleServerError = (input) => {
  const { event } = input;
  const requestId = event.request.headers.get('x-request-id') ?? undefined;
  if (input.kind === 'app') return { requestId };
  if (input.kind === 'unknown' && input.error instanceof ApiError) {
    const { error } = input;
    return {
      status: error.status >= 500 || error.status === 0 ? 502 : error.status,
      message:
        error.status >= 500 || error.status === 0
          ? 'The service is not available. Try again in a moment.'
          : error.message,
      requestId: error.problem?.requestId ?? requestId,
    };
  }
  if (input.kind === 'unknown') {
    console.error(`web: unhandled error on ${event.url.pathname}`, input.error);
    return { message: 'Something went wrong.', requestId };
  }
  return { requestId };
};
