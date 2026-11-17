// The theme colours of the instance as a stylesheet (ADR-0051): a route of the shell outside the registry rule, like the API
// reference (ADR-0038). Public: the sign-in page and every anonymous page are drawn in the same colours, and nothing here is private.
import type { RequestHandler } from './$types';
import { loadBranding } from '#lib/server/branding.ts';
import { themeSheet } from '#lib/server/theme.ts';

export const GET: RequestHandler = async ({ locals, url }) => {
  const { css, cacheControl } = themeSheet(
    await loadBranding(locals.api),
    url.searchParams.get('v'),
  );
  return new Response(css, {
    headers: { 'content-type': 'text/css; charset=utf-8', 'cache-control': cacheControl },
  });
};
